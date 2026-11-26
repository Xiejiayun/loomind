import { streamObject, type LanguageModelV1 } from "ai";
import {
  createRichText,
  createTopic,
  findTopicLocation,
  generateId,
  getLocale,
  richTextToPlainText,
  type Locale,
  type MindmapStructure,
  type PaletteId,
  type SkeletonId,
  type SyncAdapter,
} from "@mindmap/core";
import {
  AI_LIMITS,
  AiSafeCommandSchema,
  isValidPalette,
  isValidSkeleton,
  isValidStructure,
  sanitizeAiMindmapPartial,
  serializeAiContext,
  type AiIntent,
  type AiSafeCommand,
  type AiStreamEvent,
  type AiStreamMeta,
  type AiTier,
  type AiTransport,
} from "./protocol.js";
import { AiMindmapStreamSchema, type AiMindmapStream, type AiTopicNode, type DeepPartial } from "./schema.js";
import { reconcileStreamingTree } from "./stream-patcher.js";

export type NodeAiActionKind =
  | "expand"
  | "tasks"
  | "summarize"
  | "cluster"
  | "elaborateNote"
  | "restyle";

export interface StreamGenerateOptions {
  adapter: SyncAdapter;
  sheetId: string;
  prompt: string;
  model?: LanguageModelV1;
  transport?: AiTransport;
  tier?: AiTier;
  signal?: AbortSignal;
  locale?: Locale;
  onStep?: (partial: DeepPartial<AiMindmapStream>) => void;
  onEvent?: (event: AiStreamEvent) => void;
}

export interface NodeAiActionOptions {
  transport?: AiTransport;
  tier?: AiTier;
  prompt?: string;
  signal?: AbortSignal;
  selectedTopicIds?: string[];
  onEvent?: (event: AiStreamEvent) => void;
}

export interface AiExecutionResult {
  message: string;
  summary: string;
  appliedCount: number;
  meta?: AiStreamMeta;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function buildLocalDemoPlan(prompt: string, locale: Locale): AiMindmapStream {
  if (locale === "en") {
    const topic = prompt.trim() || "AI Product Innovation Plan";
    return {
      title: topic,
      recommendedStructure: "mindmap",
      recommendedPalette: "aurora",
      root: {
        title: topic,
        subtitle: "AI Co-created",
        children: [
          {
            title: "Core Goals & Value",
            labels: ["Strategy"],
            children: [
              { title: "Clarify core user pain points", task: "todo" },
              { title: "Build differentiated experience", task: "todo" },
            ],
          },
          {
            title: "Key Capabilities",
            labels: ["Product"],
            children: [
              { title: "Fast interaction & low friction" },
              { title: "Intelligent workflow automation" },
              { title: "Open import & export ecosystem" },
            ],
          },
          {
            title: "Execution Milestones",
            labels: ["Delivery"],
            children: [
              { title: "Validate MVP core loop", task: "todo" },
              { title: "Iterate with early adopter feedback", task: "todo" },
            ],
          },
          {
            title: "Risks & Metrics",
            children: [
              { title: "North-star retention & engagement" },
              { title: "Performance & cost guardrails" },
            ],
          },
        ],
      },
    };
  }

  const topic = prompt.trim() || "AI 产品创新方案";
  return {
    title: topic,
    recommendedStructure: "mindmap",
    recommendedPalette: "aurora",
    root: {
      title: topic,
      subtitle: "AI 实时共创生成",
      children: [
        {
          title: "核心目标与价值",
          labels: ["战略"],
          children: [
            { title: "明确核心用户痛点", task: "todo" },
            { title: "建立差异化体验壁垒", task: "todo" },
          ],
        },
        {
          title: "关键功能拆解",
          labels: ["产品"],
          children: [
            { title: "极速交互与低门槛上手" },
            { title: "智能化工作流自动化" },
            { title: "开放生态导入导出" },
          ],
        },
        {
          title: "执行里程碑",
          labels: ["落地"],
          children: [
            { title: "MVP 核心闭环验证", task: "todo" },
            { title: "种子用户增长与反馈迭代", task: "todo" },
          ],
        },
        {
          title: "风险与指标",
          children: [
            { title: "北极星留存与活跃指标" },
            { title: "性能与成本边界控制" },
          ],
        },
      ],
    },
  };
}

/**
 * Applies validated `AiSafeCommand[]` ops to the live document under a single
 * `coalesceKey` so the entire AI mutation can be undone in one step.
 */
export function applyAiCommands(
  adapter: SyncAdapter,
  sheetId: string,
  ops: AiSafeCommand[],
  coalesceKey: string,
): number {
  let applied = 0;

  for (const rawOp of ops) {
    const parsed = AiSafeCommandSchema.safeParse(rawOp);
    if (!parsed.success) continue;
    const op = parsed.data;

    const doc = adapter.getDocument();
    const sheet = doc.sheets.find((s) => s.id === sheetId);
    if (!sheet) break;
    const deletedSet = new Set(doc.deletedIds);

    switch (op.kind) {
      case "addChildren": {
        const loc = findTopicLocation(sheet, op.targetTopicId);
        if (!loc) break;
        for (const item of op.items.slice(0, 10)) {
          const newId = generateId("ai", deletedSet);
          deletedSet.add(newId);
          adapter.applyCommand(
            {
              type: "topic/addChild",
              sheetId,
              parentId: op.targetTopicId,
              newId,
              title: createRichText(item.title.trim().slice(0, AI_LIMITS.MAX_TITLE_CHARS)),
            },
            { coalesceKey },
          );
          if (item.subtitle?.trim()) {
            adapter.applyCommand(
              {
                type: "topic/setSubtitle",
                sheetId,
                topicId: newId,
                subtitle: item.subtitle.trim().slice(0, AI_LIMITS.MAX_SUBTITLE_CHARS),
              },
              { coalesceKey },
            );
          }
          if (item.labels?.length) {
            adapter.applyCommand(
              {
                type: "topic/setLabels",
                sheetId,
                topicId: newId,
                labels: item.labels.slice(0, AI_LIMITS.MAX_LABELS),
              },
              { coalesceKey },
            );
          }
          if (item.task) {
            adapter.applyCommand(
              {
                type: "topic/toggleTask",
                sheetId,
                topicId: newId,
                status: item.task,
              },
              { coalesceKey },
            );
          }
          applied += 1;
        }
        break;
      }

      case "setSummary": {
        const loc = findTopicLocation(sheet, op.targetTopicId);
        if (!loc || loc.topic.children.length === 0) break;
        adapter.applyCommand(
          {
            type: "summary/upsert",
            sheetId,
            summary: {
              id: generateId("sum", deletedSet),
              parentId: op.targetTopicId,
              startIndex: 0,
              endIndex: loc.topic.children.length - 1,
              brace: "curly",
              topic: createTopic(generateId("sumt", deletedSet), op.title.trim().slice(0, AI_LIMITS.MAX_TITLE_CHARS), {
                ...(op.note?.trim()
                  ? { note: { format: "markdown", text: op.note.trim().slice(0, 2000) } }
                  : {}),
              }),
            },
          },
          { coalesceKey },
        );
        applied += 1;
        break;
      }

      case "setBoundary": {
        const loc = findTopicLocation(sheet, op.targetTopicId);
        if (!loc) break;
        adapter.applyCommand(
          {
            type: "boundary/upsert",
            sheetId,
            boundary: {
              id: generateId("bnd", deletedSet),
              target: { kind: "subtree", topicId: op.targetTopicId },
              shape: "rounded",
              title: op.title.trim().slice(0, 60),
            },
          },
          { coalesceKey },
        );
        applied += 1;
        break;
      }

      case "setNote": {
        const loc = findTopicLocation(sheet, op.targetTopicId);
        if (!loc) break;
        adapter.applyCommand(
          {
            type: "topic/setNote",
            sheetId,
            topicId: op.targetTopicId,
            text: op.markdown.trim().slice(0, AI_LIMITS.MAX_NOTE_CHARS),
          },
          { coalesceKey },
        );
        applied += 1;
        break;
      }

      case "setStyle": {
        if (isValidStructure(op.structure)) {
          adapter.applyCommand({ type: "sheet/setLayout", sheetId, structure: op.structure }, { coalesceKey });
          applied += 1;
        }
        const patch: { skeletonId?: SkeletonId; paletteId?: PaletteId } = {};
        if (isValidSkeleton(op.skeletonId)) patch.skeletonId = op.skeletonId;
        if (isValidPalette(op.paletteId)) patch.paletteId = op.paletteId;
        if (patch.skeletonId || patch.paletteId) {
          adapter.applyCommand({ type: "theme/set", patch }, { coalesceKey });
          applied += 1;
        }
        break;
      }
    }
  }

  return applied;
}

/**
 * Unified SSE execution entry point for both full-map generation and node actions
 * when using Loomind's backend `AiTransport` (`/api/ai/stream`).
 */
export async function executeRemoteAiStream(opts: {
  adapter: SyncAdapter;
  sheetId: string;
  transport: AiTransport;
  tier: AiTier;
  intent: AiIntent;
  prompt: string;
  locale?: Locale;
  targetTopicId?: string;
  selectedTopicIds?: string[];
  signal?: AbortSignal;
  onStep?: (partial: DeepPartial<AiMindmapStream>) => void;
  onEvent?: (event: AiStreamEvent) => void;
}): Promise<AiExecutionResult> {
  const { adapter, sheetId, transport, tier, intent, prompt, targetTopicId, selectedTopicIds, signal, onStep, onEvent } = opts;
  const locale = opts.locale ?? getLocale();
  const doc = adapter.getDocument();
  const sheet = doc.sheets.find((s) => s.id === sheetId);
  if (!sheet) {
    return {
      message: locale === "en" ? "Sheet not found" : "未找到画布",
      summary: "",
      appliedCount: 0,
    };
  }

  const rootId = sheet.rootTopic.id;
  const prefix = `ai${Date.now().toString(36).slice(-4)}`;
  const coalesceKey = `copilot:${prefix}`;
  const context = serializeAiContext(doc, sheetId, targetTopicId ?? null, selectedTopicIds ?? []);

  let rootReset = false;
  let meta: AiStreamMeta | undefined;
  let messageText = "";
  let doneSummary = "";
  let appliedCount = 0;

  for await (const ev of transport.stream(
    {
      tier,
      intent,
      prompt: prompt.trim().slice(0, AI_LIMITS.MAX_PROMPT_CHARS),
      locale,
      targetTopicId: targetTopicId ?? rootId,
      context,
    },
    signal,
  )) {
    onEvent?.(ev);
    if (ev.event === "meta") {
      meta = ev.data;
    } else if (ev.event === "map_patch") {
      const sanitized = sanitizeAiMindmapPartial(ev.data.partial);
      if (!rootReset) {
        rootReset = true;
        adapter.applyCommand(
          {
            type: "doc/replaceSheetRoot",
            sheetId,
            rootTopic: createTopic(
              rootId,
              sanitized.root?.title || prompt.trim().slice(0, AI_LIMITS.MAX_TITLE_CHARS) || (locale === "en" ? "Generating..." : "生成中..."),
            ),
          },
          { coalesceKey },
        );
      }
      if (sanitized.recommendedStructure) {
        adapter.applyCommand(
          { type: "sheet/setLayout", sheetId, structure: sanitized.recommendedStructure },
          { coalesceKey },
        );
      }
      if (sanitized.recommendedPalette) {
        adapter.applyCommand(
          { type: "theme/set", patch: { paletteId: sanitized.recommendedPalette } },
          { coalesceKey },
        );
      }
      if (sanitized.root) {
        reconcileStreamingTree(adapter, sheetId, rootId, sanitized.root, prefix, { coalesceKey });
        appliedCount += 1;
      }
      onStep?.(sanitized);
    } else if (ev.event === "commands") {
      appliedCount += applyAiCommands(adapter, sheetId, ev.data.ops, coalesceKey);
    } else if (ev.event === "message_delta") {
      messageText += ev.data.delta;
    } else if (ev.event === "done") {
      doneSummary = ev.data.summary;
      if (appliedCount === 0 && ev.data.appliedCount > 0) {
        appliedCount = ev.data.appliedCount;
      }
    }
  }

  const fallbackSummary =
    locale === "en" ? "Updated mind map" : "已更新思维导图";
  return {
    message: messageText.trim() || doneSummary || fallbackSummary,
    summary: doneSummary || messageText.trim() || fallbackSummary,
    appliedCount,
    meta,
  };
}

/**
 * Generates a full mindmap with live branch-by-branch streaming growth.
 * Uses remote `AiTransport` (`/api/ai/stream`) when provided, Vercel AI SDK
 * `streamObject` when a `model` is provided, or falls back to a deterministic
 * progressive local stream for zero-config demos/tests.
 */
export async function streamGenerateMindmap(opts: StreamGenerateOptions): Promise<AiExecutionResult | void> {
  const { adapter, sheetId, prompt, model, transport, tier = "free", signal, onStep, onEvent } = opts;
  const locale = opts.locale ?? getLocale();

  if (transport) {
    return executeRemoteAiStream({
      adapter,
      sheetId,
      transport,
      tier,
      intent: "generate_map",
      prompt,
      locale,
      signal,
      onStep,
      onEvent,
    });
  }

  const doc = adapter.getDocument();
  const sheet = doc.sheets.find((s) => s.id === sheetId);
  if (!sheet) return;

  const prefix = `ai${Date.now().toString(36).slice(-4)}`;
  const coalesceKey = `ai-stream:${prefix}`;
  const rootId = sheet.rootTopic.id;

  // Reset root children cleanly
  adapter.applyCommand(
    {
      type: "doc/replaceSheetRoot",
      sheetId,
      rootTopic: createTopic(rootId, prompt.trim() || (locale === "en" ? "Generating..." : "生成中...")),
    },
    { coalesceKey },
  );

  if (model) {
    const { partialObjectStream } = streamObject({
      model,
      schema: AiMindmapStreamSchema,
      prompt:
        locale === "en"
          ? `Generate a clear, well-structured mind map about "${prompt}".`
          : `请围绕主题「${prompt}」生成结构清晰、层次分明的思维导图。`,
    });

    for await (const partial of partialObjectStream) {
      if (signal?.aborted) break;
      const sanitized = sanitizeAiMindmapPartial(partial as DeepPartial<AiMindmapStream>);
      if (sanitized.recommendedStructure) {
        adapter.applyCommand(
          { type: "sheet/setLayout", sheetId, structure: sanitized.recommendedStructure },
          { coalesceKey },
        );
      }
      if (sanitized.recommendedPalette) {
        adapter.applyCommand(
          { type: "theme/set", patch: { paletteId: sanitized.recommendedPalette } },
          { coalesceKey },
        );
      }
      reconcileStreamingTree(adapter, sheetId, rootId, sanitized.root, prefix, { coalesceKey });
      onStep?.(sanitized);
    }
    return;
  }

  // Deterministic progressive local streaming (grows branch by branch)
  const plan = buildLocalDemoPlan(prompt, locale);
  adapter.applyCommand({ type: "sheet/setLayout", sheetId, structure: plan.recommendedStructure }, { coalesceKey });
  adapter.applyCommand({ type: "theme/set", patch: { paletteId: plan.recommendedPalette } }, { coalesceKey });

  const progressive: DeepPartial<AiTopicNode> = {
    title: plan.root.title,
    subtitle: plan.root.subtitle,
    children: [],
  };

  for (const branch of plan.root.children ?? []) {
    if (signal?.aborted) break;
    const bCopy: DeepPartial<AiTopicNode> = {
      title: branch.title,
      labels: branch.labels,
      children: [],
    };
    progressive.children!.push(bCopy);
    reconcileStreamingTree(adapter, sheetId, rootId, progressive, prefix, { coalesceKey });
    onStep?.({ ...plan, root: progressive });
    await sleep(90);

    for (const leaf of branch.children ?? []) {
      if (signal?.aborted) break;
      bCopy.children!.push(leaf);
      reconcileStreamingTree(adapter, sheetId, rootId, progressive, prefix, { coalesceKey });
      onStep?.({ ...plan, root: progressive });
      await sleep(70);
    }
  }
}

/** Execute one of the 6 node-level AI co-creation actions */
export async function runNodeAiAction(
  adapter: SyncAdapter,
  sheetId: string,
  topicId: string,
  action: NodeAiActionKind,
  locale: Locale = getLocale(),
  opts?: NodeAiActionOptions,
): Promise<string> {
  if (opts?.transport) {
    const result = await executeRemoteAiStream({
      adapter,
      sheetId,
      transport: opts.transport,
      tier: opts.tier ?? "free",
      intent: action,
      prompt: opts.prompt || action,
      locale,
      targetTopicId: topicId,
      selectedTopicIds: opts.selectedTopicIds,
      signal: opts.signal,
      onEvent: opts.onEvent,
    });
    return result.message;
  }

  const doc = adapter.getDocument();
  const sheet = doc.sheets.find((s) => s.id === sheetId);
  if (!sheet) return locale === "en" ? "Sheet not found" : "未找到画布";
  const loc = findTopicLocation(sheet, topicId);
  if (!loc) return locale === "en" ? "Topic not found" : "未找到主题";

  const title = richTextToPlainText(loc.topic.title);
  const deletedSet = new Set(doc.deletedIds);
  const isEn = locale === "en";
  const coalesceKey = `ai-node:${action}:${Date.now().toString(36)}`;

  switch (action) {
    case "expand": {
      const ideas = isEn
        ? [
            `${title} · Key Elements`,
            `${title} · Core Scenarios`,
            `${title} · Best Practices`,
            `${title} · Potential Risks`,
          ]
        : [
            `${title} · 核心要素`,
            `${title} · 关键场景`,
            `${title} · 最佳实践`,
            `${title} · 潜在挑战`,
          ];
      for (const idea of ideas) {
        adapter.applyCommand(
          {
            type: "topic/addChild",
            sheetId,
            parentId: topicId,
            newId: generateId("ai", deletedSet),
            title: createRichText(idea),
          },
          { coalesceKey },
        );
        await sleep(50);
      }
      return isEn ? `Expanded 4 subtopics for "${title}"` : `已为「${title}」扩展 4 个子主题`;
    }

    case "tasks": {
      const steps = isEn
        ? [
            `Scope requirements for "${title}"`,
            `Draft design proposal for "${title}"`,
            `Build & test core implementation`,
            `Launch retrospective & track metrics`,
          ]
        : [
            `调研「${title}」需求边界`,
            `输出「${title}」设计方案`,
            `完成核心开发与自测`,
            `上线复盘并沉淀指标`,
          ];
      for (const s of steps) {
        const newId = generateId("ait", deletedSet);
        adapter.applyCommand(
          {
            type: "topic/addChild",
            sheetId,
            parentId: topicId,
            newId,
            title: createRichText(s),
          },
          { coalesceKey },
        );
        adapter.applyCommand(
          {
            type: "topic/toggleTask",
            sheetId,
            topicId: newId,
            status: "todo",
          },
          { coalesceKey },
        );
        await sleep(40);
      }
      return isEn ? "Created 4 actionable tasks" : "已拆解 4 项可执行任务";
    }

    case "summarize": {
      if (loc.topic.children.length === 0) {
        return isEn ? "No child topics to summarize" : "该节点暂无子节点可概要";
      }
      const childTitles = loc.topic.children.map((c) => richTextToPlainText(c.title)).join(" / ");
      adapter.applyCommand(
        {
          type: "summary/upsert",
          sheetId,
          summary: {
            id: generateId("sum", deletedSet),
            parentId: topicId,
            startIndex: 0,
            endIndex: loc.topic.children.length - 1,
            brace: "curly",
            topic: createTopic(
              generateId("sumt", deletedSet),
              isEn
                ? `Key Takeaway: Focus on ${title} (${loc.topic.children.length} items)`
                : `核心结论：聚焦${title}（共 ${loc.topic.children.length} 项）`,
              {
                note: {
                  format: "markdown",
                  text: isEn ? `Key points: ${childTitles}` : `综合要点：${childTitles}`,
                },
              },
            ),
          },
        },
        { coalesceKey },
      );
      return isEn ? "Generated branch summary" : "已生成分支概要";
    }

    case "cluster": {
      adapter.applyCommand(
        {
          type: "boundary/upsert",
          sheetId,
          boundary: {
            id: generateId("bnd", deletedSet),
            target: { kind: "subtree", topicId },
            shape: "rounded",
            title: isEn ? `${title} Cluster` : `${title} 聚类`,
          },
        },
        { coalesceKey },
      );
      return isEn ? "Added semantic cluster boundary" : "已为分支添加语义聚类外框";
    }

    case "elaborateNote": {
      const note = isEn
        ? `### ${title}\n\n` +
          `- **Context**: Clarify key context and constraints around "${title}".\n` +
          `- **Key Actions**: Prioritize high-leverage items with measurable acceptance criteria.\n` +
          `- **Watchouts**: Sync regularly with dependencies and guard against scope creep.`
        : `### ${title}\n\n` +
          `- **背景说明**：围绕「${title}」梳理关键上下文与约束。\n` +
          `- **关键行动**：优先推进高杠杆事项并设定可量化验收标准。\n` +
          `- **注意事项**：定期同步依赖方，控制范围蔓延。`;
      adapter.applyCommand(
        {
          type: "topic/setNote",
          sheetId,
          topicId,
          text: note,
        },
        { coalesceKey },
      );
      return isEn ? "Generated structured Markdown note" : "已生成结构化 Markdown 长备注";
    }

    case "restyle": {
      const lower = title.toLowerCase();
      let structure: MindmapStructure = "mindmap";
      let skeletonId: SkeletonId = "xmind-organic";
      let paletteId: PaletteId = "xmind-rainbow";

      if (/时间|路线|里程碑|roadmap|timeline|milestone|q[1-4]|阶段|phase/.test(lower)) {
        structure = "timeline";
        paletteId = "aurora";
      } else if (/根因|因果|复盘|问题|故障|root cause|fishbone|retro|postmortem/.test(lower)) {
        structure = "fishbone";
        paletteId = "sunset-coral";
      } else if (/架构|系统|模块|工程|architecture|system|module|engineering/.test(lower)) {
        structure = "brace";
        skeletonId = "technical-elbow";
        paletteId = "blueprint";
      } else if (/组织|团队|部门|汇报|org|team|department/.test(lower)) {
        structure = "org";
        paletteId = "midnight-neon";
      } else if (/swot|矩阵|对比|matrix|compare/.test(lower)) {
        structure = "matrix";
        paletteId = "prism-vibrant";
      }

      adapter.applyCommand({ type: "sheet/setLayout", sheetId, structure }, { coalesceKey });
      adapter.applyCommand({ type: "theme/set", patch: { skeletonId, paletteId } }, { coalesceKey });
      return isEn ? `Switched to ${structure} + ${paletteId}` : `已智能切换为 ${structure} + ${paletteId}`;
    }
  }
}
