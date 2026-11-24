import { streamObject, type LanguageModelV1 } from "ai";
import {
  createRichText,
  createTopic,
  findTopicLocation,
  generateId,
  richTextToPlainText,
  type MindmapStructure,
  type PaletteId,
  type SkeletonId,
  type SyncAdapter,
} from "@mindmap/core";
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
  onStep?: (partial: DeepPartial<AiMindmapStream>) => void;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function buildLocalDemoPlan(prompt: string): AiMindmapStream {
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
 * Generates a full mindmap with live branch-by-branch streaming growth.
 * Uses Vercel AI SDK `streamObject` when a `model` is provided, or falls back
 * to a deterministic progressive local stream for zero-config demos/tests.
 */
export async function streamGenerateMindmap(opts: StreamGenerateOptions): Promise<void> {
  const { adapter, sheetId, prompt, model, onStep } = opts;
  const doc = adapter.getDocument();
  const sheet = doc.sheets.find((s) => s.id === sheetId);
  if (!sheet) return;

  const prefix = `ai${Date.now().toString(36).slice(-4)}`;
  const rootId = sheet.rootTopic.id;

  // Reset root children cleanly
  adapter.applyCommand({
    type: "doc/replaceSheetRoot",
    sheetId,
    rootTopic: createTopic(rootId, prompt.trim() || "生成中..."),
  });

  if (model) {
    const { partialObjectStream } = streamObject({
      model,
      schema: AiMindmapStreamSchema,
      prompt: `请围绕主题「${prompt}」生成结构清晰、层次分明的思维导图。`,
    });

    for await (const partial of partialObjectStream) {
      if (partial.recommendedStructure) {
        adapter.applyCommand({
          type: "sheet/setLayout",
          sheetId,
          structure: partial.recommendedStructure,
        });
      }
      if (partial.recommendedPalette) {
        adapter.applyCommand({
          type: "theme/set",
          patch: { paletteId: partial.recommendedPalette },
        });
      }
      reconcileStreamingTree(adapter, sheetId, rootId, partial.root as DeepPartial<AiTopicNode> | undefined, prefix);
      onStep?.(partial as DeepPartial<AiMindmapStream>);
    }
    return;
  }

  // Deterministic progressive local streaming (grows branch by branch)
  const plan = buildLocalDemoPlan(prompt);
  adapter.applyCommand({ type: "sheet/setLayout", sheetId, structure: plan.recommendedStructure });
  adapter.applyCommand({ type: "theme/set", patch: { paletteId: plan.recommendedPalette } });

  const progressive: DeepPartial<AiTopicNode> = {
    title: plan.root.title,
    subtitle: plan.root.subtitle,
    children: [],
  };

  for (const branch of plan.root.children ?? []) {
    const bCopy: DeepPartial<AiTopicNode> = {
      title: branch.title,
      labels: branch.labels,
      children: [],
    };
    progressive.children!.push(bCopy);
    reconcileStreamingTree(adapter, sheetId, rootId, progressive, prefix);
    onStep?.({ ...plan, root: progressive });
    await sleep(90);

    for (const leaf of branch.children ?? []) {
      bCopy.children!.push(leaf);
      reconcileStreamingTree(adapter, sheetId, rootId, progressive, prefix);
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
): Promise<string> {
  const doc = adapter.getDocument();
  const sheet = doc.sheets.find((s) => s.id === sheetId);
  if (!sheet) return "Sheet not found";
  const loc = findTopicLocation(sheet, topicId);
  if (!loc) return "Topic not found";

  const title = richTextToPlainText(loc.topic.title);
  const deletedSet = new Set(doc.deletedIds);

  switch (action) {
    case "expand": {
      const ideas = [
        `${title} · 核心要素`,
        `${title} · 关键场景`,
        `${title} · 最佳实践`,
        `${title} · 潜在挑战`,
      ];
      for (const idea of ideas) {
        adapter.applyCommand({
          type: "topic/addChild",
          sheetId,
          parentId: topicId,
          newId: generateId("ai", deletedSet),
          title: createRichText(idea),
        });
        await sleep(50);
      }
      return `已为「${title}」扩展 4 个子主题`;
    }

    case "tasks": {
      const steps = [
        `调研「${title}」需求边界`,
        `输出「${title}」设计方案`,
        `完成核心开发与自测`,
        `上线复盘并沉淀指标`,
      ];
      for (const s of steps) {
        const newId = generateId("ait", deletedSet);
        adapter.applyCommand({
          type: "topic/addChild",
          sheetId,
          parentId: topicId,
          newId,
          title: createRichText(s),
        });
        adapter.applyCommand({
          type: "topic/toggleTask",
          sheetId,
          topicId: newId,
          status: "todo",
        });
        await sleep(40);
      }
      return `已拆解 4 项可执行任务`;
    }

    case "summarize": {
      if (loc.topic.children.length === 0) return "该节点暂无子节点可概要";
      const childTitles = loc.topic.children.map((c) => richTextToPlainText(c.title)).join(" / ");
      adapter.applyCommand({
        type: "summary/upsert",
        sheetId,
        summary: {
          id: generateId("sum", deletedSet),
          parentId: topicId,
          startIndex: 0,
          endIndex: loc.topic.children.length - 1,
          brace: "curly",
          topic: createTopic(generateId("sumt", deletedSet), `核心结论：聚焦${title}（共 ${loc.topic.children.length} 项）`, {
            note: { format: "markdown", text: `综合要点：${childTitles}` },
          }),
        },
      });
      return "已生成分支概要";
    }

    case "cluster": {
      adapter.applyCommand({
        type: "boundary/upsert",
        sheetId,
        boundary: {
          id: generateId("bnd", deletedSet),
          target: { kind: "subtree", topicId },
          shape: "rounded",
          title: `${title} 聚类`,
        },
      });
      return "已为分支添加语义聚类外框";
    }

    case "elaborateNote": {
      const note =
        `### ${title}\n\n` +
        `- **背景说明**：围绕「${title}」梳理关键上下文与约束。\n` +
        `- **关键行动**：优先推进高杠杆事项并设定可量化验收标准。\n` +
        `- **注意事项**：定期同步依赖方，控制范围蔓延。`;
      adapter.applyCommand({
        type: "topic/setNote",
        sheetId,
        topicId,
        text: note,
      });
      return "已生成结构化 Markdown 长备注";
    }

    case "restyle": {
      const lower = title.toLowerCase();
      let structure: MindmapStructure = "mindmap";
      let skeletonId: SkeletonId = "xmind-organic";
      let paletteId: PaletteId = "xmind-rainbow";

      if (/时间|路线|里程碑|roadmap|q[1-4]|阶段/.test(lower)) {
        structure = "timeline";
        paletteId = "aurora";
      } else if (/根因|因果|复盘|问题|故障/.test(lower)) {
        structure = "fishbone";
        paletteId = "sunset-coral";
      } else if (/架构|系统|模块|工程/.test(lower)) {
        structure = "brace";
        skeletonId = "technical-elbow";
        paletteId = "blueprint";
      } else if (/组织|团队|部门|汇报/.test(lower)) {
        structure = "org";
        paletteId = "midnight-neon";
      } else if (/swot|矩阵|对比/.test(lower)) {
        structure = "matrix";
        paletteId = "prism-vibrant";
      }

      adapter.applyCommand({ type: "sheet/setLayout", sheetId, structure });
      adapter.applyCommand({ type: "theme/set", patch: { skeletonId, paletteId } });
      return `已智能切换为 ${structure} + ${paletteId}`;
    }
  }
}
