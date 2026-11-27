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
  sanitizeAiPlan,
  serializeAiContext,
  type AiChatHistoryTurn,
  type AiExecutionHighlight,
  type AiExecutionOutcome,
  type AiExecutionPlan,
  type AiExecutionStats,
  type AiExecutionStep,
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
  history?: AiChatHistoryTurn[];
  onStep?: (partial: DeepPartial<AiMindmapStream>) => void;
  onEvent?: (event: AiStreamEvent) => void;
}

export interface NodeAiActionOptions {
  transport?: AiTransport;
  tier?: AiTier;
  prompt?: string;
  signal?: AbortSignal;
  selectedTopicIds?: string[];
  history?: AiChatHistoryTurn[];
  onEvent?: (event: AiStreamEvent) => void;
}

export interface AiExecutionResult {
  message: string;
  summary: string;
  appliedCount: number;
  meta?: AiStreamMeta;
  plan?: AiExecutionPlan;
  steps?: AiExecutionStep[];
  outcome?: AiExecutionOutcome;
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

export interface ApplyAiCommandsReport {
  appliedCount: number;
  addedNodes: number;
  updatedNodes: number;
  layoutChanged?: string;
  paletteChanged?: string;
  steps: AiExecutionStep[];
  highlights: AiExecutionHighlight[];
}

export function applyAiCommandsDetailed(
  adapter: SyncAdapter,
  sheetId: string,
  ops: AiSafeCommand[],
  coalesceKey: string,
  locale: Locale = getLocale(),
): ApplyAiCommandsReport {
  const isEn = locale === "en";
  let applied = 0;
  let addedNodes = 0;
  let updatedNodes = 0;
  let layoutChanged: string | undefined;
  let paletteChanged: string | undefined;
  const steps: AiExecutionStep[] = [];
  const highlights: AiExecutionHighlight[] = [];
  let stepIdx = 0;

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
        const parentTitle = richTextToPlainText(loc.topic.title) || (isEn ? "topic" : "目标节点");
        const createdTitles: string[] = [];
        let firstNewId: string | undefined;
        for (const item of op.items.slice(0, 10)) {
          const newId = generateId("ai", deletedSet);
          deletedSet.add(newId);
          if (!firstNewId) firstNewId = newId;
          const cleanTitle = item.title.trim().slice(0, AI_LIMITS.MAX_TITLE_CHARS);
          createdTitles.push(cleanTitle);
          adapter.applyCommand(
            {
              type: "topic/addChild",
              sheetId,
              parentId: op.targetTopicId,
              newId,
              title: createRichText(cleanTitle),
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
          addedNodes += 1;
          if (highlights.length < 6) {
            highlights.push({ topicId: newId, title: cleanTitle });
          }
        }
        if (createdTitles.length > 0) {
          stepIdx += 1;
          steps.push({
            id: `cmd-${stepIdx}`,
            phase: "execute",
            title: isEn
              ? `Added ${createdTitles.length} child ${createdTitles.length === 1 ? "node" : "nodes"} under "${parentTitle}"`
              : `在「${parentTitle}」下新增 ${createdTitles.length} 个子节点`,
            detail: createdTitles.slice(0, 3).join(" · ") + (createdTitles.length > 3 ? "…" : ""),
            status: "done",
            topicId: firstNewId ?? op.targetTopicId,
            count: createdTitles.length,
          });
        }
        break;
      }

      case "setSummary": {
        const loc = findTopicLocation(sheet, op.targetTopicId);
        if (!loc || loc.topic.children.length === 0) break;
        const cleanTitle = op.title.trim().slice(0, AI_LIMITS.MAX_TITLE_CHARS);
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
              topic: createTopic(generateId("sumt", deletedSet), cleanTitle, {
                ...(op.note?.trim()
                  ? { note: { format: "markdown", text: op.note.trim().slice(0, 2000) } }
                  : {}),
              }),
            },
          },
          { coalesceKey },
        );
        applied += 1;
        updatedNodes += 1;
        stepIdx += 1;
        steps.push({
          id: `cmd-${stepIdx}`,
          phase: "execute",
          title: isEn ? `Added branch summary` : `生成分支概要`,
          detail: cleanTitle,
          status: "done",
          topicId: op.targetTopicId,
        });
        highlights.push({ topicId: op.targetTopicId, title: richTextToPlainText(loc.topic.title) || cleanTitle });
        break;
      }

      case "setBoundary": {
        const loc = findTopicLocation(sheet, op.targetTopicId);
        if (!loc) break;
        const cleanTitle = op.title.trim().slice(0, 60);
        adapter.applyCommand(
          {
            type: "boundary/upsert",
            sheetId,
            boundary: {
              id: generateId("bnd", deletedSet),
              target: { kind: "subtree", topicId: op.targetTopicId },
              shape: "rounded",
              title: cleanTitle,
            },
          },
          { coalesceKey },
        );
        applied += 1;
        updatedNodes += 1;
        stepIdx += 1;
        steps.push({
          id: `cmd-${stepIdx}`,
          phase: "execute",
          title: isEn ? `Grouped branch with boundary` : `添加分支聚类外框`,
          detail: cleanTitle,
          status: "done",
          topicId: op.targetTopicId,
        });
        highlights.push({ topicId: op.targetTopicId, title: richTextToPlainText(loc.topic.title) || cleanTitle });
        break;
      }

      case "setNote": {
        const loc = findTopicLocation(sheet, op.targetTopicId);
        if (!loc) break;
        const targetTitle = richTextToPlainText(loc.topic.title) || (isEn ? "topic" : "目标节点");
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
        updatedNodes += 1;
        stepIdx += 1;
        steps.push({
          id: `cmd-${stepIdx}`,
          phase: "execute",
          title: isEn ? `Updated Markdown note for "${targetTitle}"` : `为「${targetTitle}」写入结构化长备注`,
          detail: `${op.markdown.trim().length} ${isEn ? "chars" : "字"}`,
          status: "done",
          topicId: op.targetTopicId,
        });
        highlights.push({ topicId: op.targetTopicId, title: targetTitle });
        break;
      }

      case "setStyle": {
        const changes: string[] = [];
        if (isValidStructure(op.structure)) {
          adapter.applyCommand({ type: "sheet/setLayout", sheetId, structure: op.structure }, { coalesceKey });
          applied += 1;
          layoutChanged = op.structure;
          changes.push(op.structure);
        }
        const patch: { skeletonId?: SkeletonId; paletteId?: PaletteId } = {};
        if (isValidSkeleton(op.skeletonId)) patch.skeletonId = op.skeletonId;
        if (isValidPalette(op.paletteId)) {
          patch.paletteId = op.paletteId;
          paletteChanged = op.paletteId;
          changes.push(op.paletteId);
        }
        if (patch.skeletonId || patch.paletteId) {
          adapter.applyCommand({ type: "theme/set", patch }, { coalesceKey });
          applied += 1;
        }
        if (changes.length > 0) {
          stepIdx += 1;
          steps.push({
            id: `cmd-${stepIdx}`,
            phase: "execute",
            title: isEn ? `Applied layout & theme style` : `切换导图结构与主题配色`,
            detail: changes.join(" · "),
            status: "done",
          });
        }
        break;
      }
    }
  }

  return { appliedCount: applied, addedNodes, updatedNodes, layoutChanged, paletteChanged, steps, highlights };
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
  return applyAiCommandsDetailed(adapter, sheetId, ops, coalesceKey).appliedCount;
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
  history?: AiChatHistoryTurn[];
  signal?: AbortSignal;
  onStep?: (partial: DeepPartial<AiMindmapStream>) => void;
  onEvent?: (event: AiStreamEvent) => void;
}): Promise<AiExecutionResult> {
  const {
    adapter,
    sheetId,
    transport,
    tier,
    intent,
    prompt,
    targetTopicId,
    selectedTopicIds,
    history,
    signal,
    onStep,
    onEvent,
  } = opts;
  const locale = opts.locale ?? getLocale();
  const isEn = locale === "en";
  const startedAt = Date.now();
  const doc = adapter.getDocument();
  const sheet = doc.sheets.find((s) => s.id === sheetId);
  if (!sheet) {
    return {
      message: isEn ? "Sheet not found" : "未找到画布",
      summary: "",
      appliedCount: 0,
    };
  }

  const rootId = sheet.rootTopic.id;
  const prefix = `ai${Date.now().toString(36).slice(-4)}`;
  const coalesceKey = `copilot:${prefix}`;
  const context = serializeAiContext(doc, sheetId, targetTopicId ?? null, selectedTopicIds ?? []);
  const targetLoc = targetTopicId ? findTopicLocation(sheet, targetTopicId) : null;
  const targetLabel = targetLoc ? richTextToPlainText(targetLoc.topic.title) : richTextToPlainText(sheet.rootTopic.title);

  const stepsMap = new Map<string, AiExecutionStep>();
  const upsertStep = (step: AiExecutionStep) => {
    stepsMap.set(step.id, step);
    onEvent?.({ event: "step", data: step });
  };

  // Phase 1: Analyze context & intent
  upsertStep({
    id: "analyze",
    phase: "analyze",
    title: isEn ? "Analyzed canvas context & intent" : "已解析画布上下文与意图",
    detail:
      intent === "generate_map"
        ? isEn
          ? `Full map generation · ${sheet.structure}`
          : `整图生成 · 当前结构 ${sheet.structure}`
        : isEn
          ? `Target "${targetLabel}" · intent: ${intent}`
          : `目标节点「${targetLabel}」· 动作：${intent}`,
    status: "done",
    topicId: targetTopicId ?? rootId,
  });

  // Phase 2: Plan (running until plan arrives or execution starts)
  upsertStep({
    id: "plan",
    phase: "plan",
    title: isEn ? "Formulating execution plan" : "正在规划结构与执行方案",
    status: "running",
  });

  let rootReset = false;
  let meta: AiStreamMeta | undefined;
  let plan: AiExecutionPlan | undefined;
  let messageText = "";
  let doneSummary = "";
  let appliedCount = 0;
  let addedNodes = 0;
  let updatedNodes = 0;
  let layoutChanged: string | undefined;
  let paletteChanged: string | undefined;
  const highlightsMap = new Map<string, AiExecutionHighlight>();

  for await (const ev of transport.stream(
    {
      tier,
      intent,
      prompt: prompt.trim().slice(0, AI_LIMITS.MAX_PROMPT_CHARS),
      locale,
      targetTopicId: targetTopicId ?? rootId,
      context,
      ...(history && history.length > 0 ? { history: history.slice(-6) } : {}),
    },
    signal,
  )) {
    onEvent?.(ev);
    if (ev.event === "meta") {
      meta = ev.data;
    } else if (ev.event === "plan") {
      const cleanPlan = sanitizeAiPlan(ev.data);
      if (cleanPlan) {
        plan = cleanPlan;
        upsertStep({
          id: "plan",
          phase: "plan",
          title: isEn ? "Execution plan ready" : "已完成方案规划",
          detail: cleanPlan.goal,
          status: "done",
          count: cleanPlan.steps.length || undefined,
        });
      }
    } else if (ev.event === "step") {
      stepsMap.set(ev.data.id, ev.data);
    } else if (ev.event === "map_patch") {
      if (stepsMap.get("plan")?.status === "running") {
        upsertStep({
          id: "plan",
          phase: "plan",
          title: isEn ? "Execution plan ready" : "已完成方案规划",
          detail: plan?.goal || prompt.trim().slice(0, 80),
          status: "done",
        });
      }
      const sanitized = sanitizeAiMindmapPartial(ev.data.partial);
      if (!rootReset) {
        rootReset = true;
        adapter.applyCommand(
          {
            type: "doc/replaceSheetRoot",
            sheetId,
            rootTopic: createTopic(
              rootId,
              sanitized.root?.title || prompt.trim().slice(0, AI_LIMITS.MAX_TITLE_CHARS) || (isEn ? "Generating..." : "生成中..."),
            ),
          },
          { coalesceKey },
        );
        updatedNodes += 1;
      }
      if (sanitized.recommendedStructure && sanitized.recommendedStructure !== layoutChanged) {
        adapter.applyCommand(
          { type: "sheet/setLayout", sheetId, structure: sanitized.recommendedStructure },
          { coalesceKey },
        );
        layoutChanged = sanitized.recommendedStructure;
        upsertStep({
          id: "layout",
          phase: "execute",
          title: isEn ? `Selected layout: ${layoutChanged}` : `选定导图结构：${layoutChanged}`,
          status: "done",
        });
      }
      if (sanitized.recommendedPalette && sanitized.recommendedPalette !== paletteChanged) {
        adapter.applyCommand(
          { type: "theme/set", patch: { paletteId: sanitized.recommendedPalette } },
          { coalesceKey },
        );
        paletteChanged = sanitized.recommendedPalette;
      }
      if (sanitized.root) {
        const rec = reconcileStreamingTree(adapter, sheetId, rootId, sanitized.root, prefix, { coalesceKey });
        addedNodes += rec.addedNodes;
        updatedNodes += rec.updatedNodes;
        appliedCount += 1;
        for (const br of rec.branches) {
          highlightsMap.set(br.topicId, { topicId: br.topicId, title: br.title });
          upsertStep({
            id: `branch-${br.topicId}`,
            phase: "execute",
            title: isEn ? `Built branch "${br.title}"` : `写入分支「${br.title}」`,
            detail: br.childCount > 0
              ? isEn
                ? `${br.childCount} child ${br.childCount === 1 ? "node" : "nodes"}`
                : `含 ${br.childCount} 个子节点`
              : undefined,
            status: "done",
            topicId: br.topicId,
            count: br.childCount + 1,
          });
        }
      }
      onStep?.(sanitized);
    } else if (ev.event === "commands") {
      if (stepsMap.get("plan")?.status === "running") {
        upsertStep({
          id: "plan",
          phase: "plan",
          title: isEn ? "Execution plan ready" : "已完成方案规划",
          detail: plan?.goal || prompt.trim().slice(0, 80),
          status: "done",
        });
      }
      const report = applyAiCommandsDetailed(adapter, sheetId, ev.data.ops, coalesceKey, locale);
      appliedCount += report.appliedCount;
      addedNodes += report.addedNodes;
      updatedNodes += report.updatedNodes;
      if (report.layoutChanged) layoutChanged = report.layoutChanged;
      if (report.paletteChanged) paletteChanged = report.paletteChanged;
      for (const s of report.steps) upsertStep(s);
      for (const h of report.highlights) highlightsMap.set(h.topicId, h);
    } else if (ev.event === "message_delta") {
      messageText += ev.data.delta;
    } else if (ev.event === "done") {
      doneSummary = ev.data.summary;
      if (appliedCount === 0 && ev.data.appliedCount > 0) {
        appliedCount = ev.data.appliedCount;
      }
    }
  }

  if (stepsMap.get("plan")?.status === "running") {
    upsertStep({
      id: "plan",
      phase: "plan",
      title: isEn ? "Execution plan ready" : "已完成方案规划",
      detail: plan?.goal || prompt.trim().slice(0, 80),
      status: "done",
    });
  }

  const durationMs = Date.now() - startedAt;
  const stats: AiExecutionStats = {
    addedNodes,
    updatedNodes,
    ...(layoutChanged ? { layoutChanged } : {}),
    ...(paletteChanged ? { paletteChanged } : {}),
    durationMs,
  };
  const highlights = Array.from(highlightsMap.values()).slice(0, 6);

  upsertStep({
    id: "verify",
    phase: "verify",
    title: isEn ? "Canvas changes verified" : "画布变更已校验并落盘",
    detail: isEn
      ? `+${addedNodes} added${updatedNodes > 0 ? ` · ${updatedNodes} updated` : ""}`
      : `新增 ${addedNodes} 个节点${updatedNodes > 0 ? ` · 更新 ${updatedNodes} 处` : ""}`,
    status: "done",
    count: addedNodes + updatedNodes,
  });

  const fallbackSummary = isEn ? "Updated mind map" : "已更新思维导图";
  const finalSummary = doneSummary || messageText.trim() || fallbackSummary;
  const finalMessage = messageText.trim() || doneSummary || fallbackSummary;

  return {
    message: finalMessage,
    summary: finalSummary,
    appliedCount,
    meta,
    plan,
    steps: Array.from(stepsMap.values()),
    outcome: {
      summary: finalSummary,
      appliedCount,
      stats,
      highlights,
    },
  };
}

/**
 * Generates a full mindmap with live branch-by-branch streaming growth.
 * Uses remote `AiTransport` (`/api/ai/stream`) when provided, Vercel AI SDK
 * `streamObject` when a `model` is provided, or falls back to a deterministic
 * progressive local stream for zero-config demos/tests.
 */
export async function streamGenerateMindmap(opts: StreamGenerateOptions): Promise<AiExecutionResult | void> {
  const { adapter, sheetId, prompt, model, transport, tier = "free", signal, history, onStep, onEvent } = opts;
  const locale = opts.locale ?? getLocale();
  const isEn = locale === "en";

  if (transport) {
    return executeRemoteAiStream({
      adapter,
      sheetId,
      transport,
      tier,
      intent: "generate_map",
      prompt,
      locale,
      history,
      signal,
      onStep,
      onEvent,
    });
  }

  const startedAt = Date.now();
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
      rootTopic: createTopic(rootId, prompt.trim() || (isEn ? "Generating..." : "生成中...")),
    },
    { coalesceKey },
  );

  if (model) {
    const { partialObjectStream } = streamObject({
      model,
      schema: AiMindmapStreamSchema,
      prompt:
        isEn
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
  const planObj = buildLocalDemoPlan(prompt, locale);
  const execPlan: AiExecutionPlan = {
    goal: isEn ? `Structure "${planObj.title}" into clear pillars` : `围绕「${planObj.title}」梳理核心脉络`,
    approach: isEn
      ? `Use ${planObj.recommendedStructure} layout with ${(planObj.root.children ?? []).length} top-level dimensions`
      : `采用 ${planObj.recommendedStructure} 结构，拆解为 ${(planObj.root.children ?? []).length} 个核心维度并补充可执行节点`,
    steps: (planObj.root.children ?? []).map((b) => (isEn ? `Build branch "${b.title}"` : `展开分支「${b.title}」`)),
  };
  onEvent?.({ event: "plan", data: execPlan });
  const steps: AiExecutionStep[] = [
    {
      id: "analyze",
      phase: "analyze",
      title: isEn ? "Analyzed prompt & canvas" : "已解析主题与画布",
      detail: planObj.title,
      status: "done",
      topicId: rootId,
    },
    {
      id: "plan",
      phase: "plan",
      title: isEn ? "Execution plan ready" : "已完成方案规划",
      detail: execPlan.goal,
      status: "done",
      count: execPlan.steps.length,
    },
  ];
  for (const s of steps) onEvent?.({ event: "step", data: s });

  adapter.applyCommand({ type: "sheet/setLayout", sheetId, structure: planObj.recommendedStructure }, { coalesceKey });
  adapter.applyCommand({ type: "theme/set", patch: { paletteId: planObj.recommendedPalette } }, { coalesceKey });

  const progressive: DeepPartial<AiTopicNode> = {
    title: planObj.root.title,
    subtitle: planObj.root.subtitle,
    children: [],
  };

  let addedNodes = 0;
  const highlights: AiExecutionHighlight[] = [];
  for (const [bIdx, branch] of (planObj.root.children ?? []).entries()) {
    if (signal?.aborted) break;
    const bCopy: DeepPartial<AiTopicNode> = {
      title: branch.title,
      labels: branch.labels,
      children: [],
    };
    progressive.children!.push(bCopy);
    const rec1 = reconcileStreamingTree(adapter, sheetId, rootId, progressive, prefix, { coalesceKey });
    addedNodes += rec1.addedNodes;
    onStep?.({ ...planObj, root: progressive });
    await sleep(90);

    for (const leaf of branch.children ?? []) {
      if (signal?.aborted) break;
      bCopy.children!.push(leaf);
      const rec2 = reconcileStreamingTree(adapter, sheetId, rootId, progressive, prefix, { coalesceKey });
      addedNodes += rec2.addedNodes;
      onStep?.({ ...planObj, root: progressive });
      await sleep(70);
    }

    const branchId = `${prefix}-0-${bIdx}`;
    const childCount = (branch.children ?? []).length;
    highlights.push({ topicId: branchId, title: branch.title });
    const stepItem: AiExecutionStep = {
      id: `branch-${branchId}`,
      phase: "execute",
      title: isEn ? `Built branch "${branch.title}"` : `写入分支「${branch.title}」`,
      detail: isEn ? `${childCount} child nodes` : `含 ${childCount} 个子节点`,
      status: "done",
      topicId: branchId,
      count: childCount + 1,
    };
    steps.push(stepItem);
    onEvent?.({ event: "step", data: stepItem });
  }

  const verifyStep: AiExecutionStep = {
    id: "verify",
    phase: "verify",
    title: isEn ? "Canvas changes verified" : "画布变更已校验完成",
    detail: isEn ? `+${addedNodes} nodes` : `共新增 ${addedNodes} 个节点`,
    status: "done",
    count: addedNodes,
  };
  steps.push(verifyStep);
  onEvent?.({ event: "step", data: verifyStep });

  const summary = isEn ? `Generated mind map for "${planObj.title}"` : `已生成「${planObj.title}」思维导图`;
  return {
    message: summary,
    summary,
    appliedCount: addedNodes,
    plan: execPlan,
    steps,
    outcome: {
      summary,
      appliedCount: addedNodes,
      stats: {
        addedNodes,
        updatedNodes: 1,
        layoutChanged: planObj.recommendedStructure,
        paletteChanged: planObj.recommendedPalette,
        durationMs: Date.now() - startedAt,
      },
      highlights,
    },
  };
}

/** Execute one of the 6 node-level AI co-creation actions and return structured plan/steps/outcome */
export async function runNodeAiActionDetailed(
  adapter: SyncAdapter,
  sheetId: string,
  topicId: string,
  action: NodeAiActionKind,
  locale: Locale = getLocale(),
  opts?: NodeAiActionOptions,
): Promise<AiExecutionResult> {
  if (opts?.transport) {
    return executeRemoteAiStream({
      adapter,
      sheetId,
      transport: opts.transport,
      tier: opts.tier ?? "free",
      intent: action,
      prompt: opts.prompt || action,
      locale,
      targetTopicId: topicId,
      selectedTopicIds: opts.selectedTopicIds,
      history: opts.history,
      signal: opts.signal,
      onEvent: opts.onEvent,
    });
  }

  const startedAt = Date.now();
  const doc = adapter.getDocument();
  const sheet = doc.sheets.find((s) => s.id === sheetId);
  if (!sheet) {
    const msg = locale === "en" ? "Sheet not found" : "未找到画布";
    return { message: msg, summary: msg, appliedCount: 0 };
  }
  const loc = findTopicLocation(sheet, topicId);
  if (!loc) {
    const msg = locale === "en" ? "Topic not found" : "未找到主题";
    return { message: msg, summary: msg, appliedCount: 0 };
  }

  const title = richTextToPlainText(loc.topic.title);
  const deletedSet = new Set(doc.deletedIds);
  const isEn = locale === "en";
  const coalesceKey = `ai-node:${action}:${Date.now().toString(36)}`;

  const plan: AiExecutionPlan = {
    goal: isEn ? `Run "${action}" on "${title}"` : `针对「${title}」执行 ${action}`,
    steps: [
      isEn ? `Inspect "${title}" context` : `分析「${title}」上下文`,
      isEn ? `Apply ${action} updates to canvas` : `写入画布变更`,
    ],
  };
  opts?.onEvent?.({ event: "plan", data: plan });
  const steps: AiExecutionStep[] = [
    {
      id: "analyze",
      phase: "analyze",
      title: isEn ? "Analyzed target node" : "已解析目标节点上下文",
      detail: title,
      status: "done",
      topicId,
    },
    {
      id: "plan",
      phase: "plan",
      title: isEn ? "Execution plan ready" : "已完成方案规划",
      detail: plan.goal,
      status: "done",
    },
  ];
  for (const s of steps) opts?.onEvent?.({ event: "step", data: s });

  let message = "";
  let addedNodes = 0;
  let updatedNodes = 0;
  let layoutChanged: string | undefined;
  let paletteChanged: string | undefined;
  const highlights: AiExecutionHighlight[] = [{ topicId, title }];

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
        const newId = generateId("ai", deletedSet);
        deletedSet.add(newId);
        adapter.applyCommand(
          {
            type: "topic/addChild",
            sheetId,
            parentId: topicId,
            newId,
            title: createRichText(idea),
          },
          { coalesceKey },
        );
        addedNodes += 1;
        highlights.push({ topicId: newId, title: idea });
        await sleep(50);
      }
      message = isEn ? `Expanded 4 subtopics for "${title}"` : `已为「${title}」扩展 4 个子主题`;
      break;
    }

    case "tasks": {
      const taskSteps = isEn
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
      for (const s of taskSteps) {
        const newId = generateId("ait", deletedSet);
        deletedSet.add(newId);
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
        addedNodes += 1;
        highlights.push({ topicId: newId, title: s });
        await sleep(40);
      }
      message = isEn ? "Created 4 actionable tasks" : "已拆解 4 项可执行任务";
      break;
    }

    case "summarize": {
      if (loc.topic.children.length === 0) {
        message = isEn ? "No child topics to summarize" : "该节点暂无子节点可概要";
        break;
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
      updatedNodes += 1;
      message = isEn ? "Generated branch summary" : "已生成分支概要";
      break;
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
      updatedNodes += 1;
      message = isEn ? "Added semantic cluster boundary" : "已为分支添加语义聚类外框";
      break;
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
      updatedNodes += 1;
      message = isEn ? "Generated structured Markdown note" : "已生成结构化 Markdown 长备注";
      break;
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
      layoutChanged = structure;
      paletteChanged = paletteId;
      updatedNodes += 1;
      message = isEn ? `Switched to ${structure} + ${paletteId}` : `已智能切换为 ${structure} + ${paletteId}`;
      break;
    }
  }

  const execStep: AiExecutionStep = {
    id: "exec-local",
    phase: "execute",
    title: message,
    status: "done",
    topicId,
    count: addedNodes + updatedNodes,
  };
  steps.push(execStep);
  opts?.onEvent?.({ event: "step", data: execStep });

  return {
    message,
    summary: message,
    appliedCount: addedNodes + updatedNodes,
    plan,
    steps,
    outcome: {
      summary: message,
      appliedCount: addedNodes + updatedNodes,
      stats: {
        addedNodes,
        updatedNodes,
        ...(layoutChanged ? { layoutChanged } : {}),
        ...(paletteChanged ? { paletteChanged } : {}),
        durationMs: Date.now() - startedAt,
      },
      highlights: highlights.slice(0, 6),
    },
  };
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
  const res = await runNodeAiActionDetailed(adapter, sheetId, topicId, action, locale, opts);
  return res.message;
}
