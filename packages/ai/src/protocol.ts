import { z } from "zod";
import {
  findTopicLocation,
  richTextToPlainText,
  type Locale,
  type MindmapDocument,
  type MindmapStructure,
  type MindmapTopic,
  type PaletteId,
  type SkeletonId,
} from "@mindmap/core";
import type { AiMindmapStream, AiTopicNode, DeepPartial } from "./schema.js";

export type AiTier = "free" | "pro";

export type AiIntent =
  | "generate_map"
  | "expand"
  | "tasks"
  | "summarize"
  | "cluster"
  | "elaborateNote"
  | "restyle"
  | "chat";

export type AiErrorCode =
  | "AUTH_REQUIRED"
  | "RATE_LIMITED"
  | "PRO_NOT_CONFIGURED"
  | "FREE_UNAVAILABLE"
  | "UPSTREAM_ERROR"
  | "UPSTREAM_TIMEOUT"
  | "INVALID_OUTPUT"
  | "INVALID_REQUEST"
  | "ABORTED"
  | "NETWORK_ERROR";

export class AiClientError extends Error {
  constructor(
    public readonly code: AiErrorCode,
    message: string,
    public readonly status?: number,
    public readonly retryAfterSec?: number,
  ) {
    super(message);
    this.name = "AiClientError";
  }
}

export interface AiConfigResponse {
  tier: AiTier;
  available: boolean;
  isMock: boolean;
  providerLabel: string;
  modelLabel: string;
  dailyLimit: number;
  remainingToday: number;
  requiresLogin: boolean;
}

export interface CompactTopicNode {
  id: string;
  title: string;
  subtitle?: string;
  labels?: string[];
  task?: "todo" | "done";
  note?: string;
  truncatedChildren?: number;
  children?: CompactTopicNode[];
}

export interface AiContextSnapshot {
  sheetId: string;
  structure: MindmapStructure;
  paletteId: PaletteId;
  activeTopicId: string | null;
  selectedTopicIds: string[];
  outline: CompactTopicNode;
  truncated: boolean;
}

export interface AiExecutionPlan {
  goal: string;
  approach?: string;
  steps: string[];
}

export type AiStepPhase = "analyze" | "plan" | "execute" | "verify";
export type AiStepStatus = "pending" | "running" | "done" | "error";

export interface AiExecutionStep {
  id: string;
  phase: AiStepPhase;
  title: string;
  detail?: string;
  status: AiStepStatus;
  topicId?: string;
  count?: number;
}

export interface AiExecutionHighlight {
  topicId: string;
  title: string;
}

export interface AiExecutionStats {
  addedNodes: number;
  updatedNodes: number;
  layoutChanged?: string;
  paletteChanged?: string;
  durationMs?: number;
}

export interface AiExecutionOutcome {
  summary: string;
  appliedCount: number;
  stats: AiExecutionStats;
  highlights: AiExecutionHighlight[];
}

export interface AiChatHistoryTurn {
  role: "user" | "assistant";
  content: string;
  planSummary?: string;
  resultSummary?: string;
}

export interface AiStreamRequest {
  tier: AiTier;
  intent: AiIntent;
  prompt: string;
  locale: Locale;
  targetTopicId?: string;
  context?: AiContextSnapshot;
  history?: AiChatHistoryTurn[];
}

const VALID_STRUCTURES = new Set<MindmapStructure>([
  "mindmap",
  "logic",
  "org",
  "brace",
  "indented",
  "timeline",
  "fishbone",
  "treeTable",
  "matrix",
]);

const VALID_SKELETONS = new Set<SkeletonId>([
  "xmind-organic",
  "classic-cards",
  "minimal-pill",
  "editorial-underline",
  "technical-elbow",
]);

const VALID_PALETTES = new Set<PaletteId>([
  "workspace",
  "xmind-rainbow",
  "aurora",
  "warm-paper",
  "midnight-neon",
  "obsidian-gold",
  "minimal-ink",
  "prism-vibrant",
  "forest-calm",
  "sunset-coral",
  "blueprint",
]);

const STREAM_STRUCTURES = new Set<AiMindmapStream["recommendedStructure"]>([
  "mindmap",
  "logic",
  "org",
  "brace",
  "timeline",
  "fishbone",
  "treeTable",
]);

const STREAM_PALETTES = new Set<AiMindmapStream["recommendedPalette"]>([
  "xmind-rainbow",
  "aurora",
  "warm-paper",
  "midnight-neon",
  "forest-calm",
]);

export const AiSafeCommandSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("addChildren"),
    targetTopicId: z.string().min(1).max(120),
    items: z
      .array(
        z.object({
          title: z.string().min(1).max(120),
          subtitle: z.string().max(120).optional(),
          labels: z.array(z.string().min(1).max(18)).max(3).optional(),
          task: z.enum(["todo", "done"]).optional(),
        }),
      )
      .min(1)
      .max(10),
  }),
  z.object({
    kind: z.literal("setSummary"),
    targetTopicId: z.string().min(1).max(120),
    title: z.string().min(1).max(120),
    note: z.string().max(2000).optional(),
  }),
  z.object({
    kind: z.literal("setBoundary"),
    targetTopicId: z.string().min(1).max(120),
    title: z.string().min(1).max(60),
  }),
  z.object({
    kind: z.literal("setNote"),
    targetTopicId: z.string().min(1).max(120),
    markdown: z.string().min(1).max(8000),
  }),
  z.object({
    kind: z.literal("setStyle"),
    structure: z.string().optional(),
    skeletonId: z.string().optional(),
    paletteId: z.string().optional(),
  }),
]);

export type AiSafeCommand = z.infer<typeof AiSafeCommandSchema>;

export interface AiStreamMeta {
  requestId: string;
  tier: AiTier;
  providerLabel: string;
  modelLabel: string;
  isMock: boolean;
  remainingToday: number;
  dailyLimit: number;
}

export type AiStreamEvent =
  | { event: "meta"; data: AiStreamMeta }
  | { event: "status"; data: { stage: "connecting" | "thinking" | "streaming" } }
  | { event: "plan"; data: AiExecutionPlan }
  | { event: "step"; data: AiExecutionStep }
  | { event: "map_patch"; data: { partial: DeepPartial<AiMindmapStream> } }
  | { event: "commands"; data: { ops: AiSafeCommand[] } }
  | { event: "message_delta"; data: { delta: string } }
  | { event: "error"; data: { code: AiErrorCode; message: string; retryAfterSec?: number } }
  | {
      event: "done";
      data: {
        summary: string;
        appliedCount: number;
        stats?: AiExecutionStats;
        highlights?: AiExecutionHighlight[];
      };
    };

export interface AiTransport {
  stream(request: AiStreamRequest, signal?: AbortSignal): AsyncIterable<AiStreamEvent>;
}

export const AI_LIMITS = {
  MAX_PROMPT_CHARS: 2_000,
  MAX_CONTEXT_CHARS: 16_000,
  MAX_NODES: 120,
  MAX_DEPTH: 6,
  MAX_CHILDREN_PER_NODE: 12,
  MAX_TITLE_CHARS: 120,
  MAX_SUBTITLE_CHARS: 120,
  MAX_LABEL_CHARS: 18,
  MAX_LABELS: 3,
  MAX_NOTE_CHARS: 8_000,
} as const;

export function isValidStructure(v: unknown): v is MindmapStructure {
  return typeof v === "string" && VALID_STRUCTURES.has(v as MindmapStructure);
}

export function isValidSkeleton(v: unknown): v is SkeletonId {
  return typeof v === "string" && VALID_SKELETONS.has(v as SkeletonId);
}

export function isValidPalette(v: unknown): v is PaletteId {
  return typeof v === "string" && VALID_PALETTES.has(v as PaletteId);
}

/**
 * Serializes the active sheet into a compact text-only outline for AI prompts.
 * Strips binary assets (`doc.assets`) and visual styling, prioritizing the
 * active topic's ancestor path and subtree when truncating large maps.
 */
export function serializeAiContext(
  doc: MindmapDocument,
  sheetId: string,
  activeTopicId: string | null,
  selectedTopicIds: string[] = [],
  maxChars: number = AI_LIMITS.MAX_CONTEXT_CHARS,
): AiContextSnapshot {
  const sheet = doc.sheets.find((s) => s.id === sheetId) ?? doc.sheets[0];
  const ancestorIds = new Set<string>();

  if (activeTopicId) {
    const loc = findTopicLocation(sheet, activeTopicId);
    if (loc) {
      let current: string | null = loc.topic.id;
      while (current) {
        ancestorIds.add(current);
        const curLoc = findTopicLocation(sheet, current);
        current = curLoc?.parent?.id ?? null;
      }
    }
  }

  let budget = maxChars;
  let truncated = false;

  const pack = (topic: MindmapTopic, depth: number, inFocusBranch: boolean): CompactTopicNode => {
    const title = richTextToPlainText(topic.title).trim().slice(0, AI_LIMITS.MAX_TITLE_CHARS);
    const node: CompactTopicNode = { id: topic.id, title };
    budget -= title.length + topic.id.length + 24;

    if (topic.subtitle && budget > 120) {
      const sub = topic.subtitle.trim().slice(0, 80);
      if (sub) {
        node.subtitle = sub;
        budget -= sub.length + 14;
      }
    }
    if (topic.labels?.length && budget > 120) {
      node.labels = topic.labels.slice(0, 3).map((l: string) => l.slice(0, 18));
      budget -= 32;
    }
    if (topic.task?.status) {
      node.task = topic.task.status;
      budget -= 16;
    }
    if (topic.note?.text && (inFocusBranch || topic.id === activeTopicId) && budget > 240) {
      const snippet = topic.note.text.trim().slice(0, 280);
      if (snippet) {
        node.note = snippet;
        budget -= snippet.length + 12;
      }
    }

    if (topic.children.length > 0) {
      const nextFocus = inFocusBranch || topic.id === activeTopicId;
      const allowExpand = nextFocus || ancestorIds.has(topic.id) || (depth < 3 && budget > 800);
      if (!allowExpand || depth >= AI_LIMITS.MAX_DEPTH) {
        node.truncatedChildren = topic.children.length;
        truncated = true;
      } else {
        const out: CompactTopicNode[] = [];
        for (let i = 0; i < topic.children.length; i++) {
          const child = topic.children[i];
          const childImportant = nextFocus || ancestorIds.has(child.id);
          if (!childImportant && budget <= 200) {
            node.truncatedChildren = topic.children.length - i;
            truncated = true;
            break;
          }
          out.push(pack(child, depth + 1, nextFocus));
        }
        if (out.length > 0) node.children = out;
      }
    }
    return node;
  };

  const outline = pack(sheet.rootTopic, 0, activeTopicId === sheet.rootTopic.id);
  return {
    sheetId: sheet.id,
    structure: sheet.structure,
    paletteId: sheet.theme?.paletteId ?? doc.theme.paletteId,
    activeTopicId,
    selectedTopicIds: selectedTopicIds.slice(0, 10),
    outline,
    truncated,
  };
}

export function sanitizeAiPlan(raw: unknown): AiExecutionPlan | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  const goal = typeof obj.goal === "string" ? obj.goal.trim().slice(0, 220) : "";
  const approach = typeof obj.approach === "string" && obj.approach.trim()
    ? obj.approach.trim().slice(0, 280)
    : undefined;
  const steps = Array.isArray(obj.steps)
    ? obj.steps
        .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
        .map((s) => s.trim().slice(0, 120))
        .slice(0, 8)
    : [];
  if (!goal && steps.length === 0) return null;
  return {
    goal: goal || steps[0] || "",
    ...(approach ? { approach } : {}),
    steps,
  };
}

/**
 * Sanitizes a streaming partial mindmap payload against Loomind's node count,
 * depth, field length, and enum invariants before applying to the canvas.
 */
export function sanitizeAiMindmapPartial(
  raw: DeepPartial<AiMindmapStream> | undefined,
): DeepPartial<AiMindmapStream> {
  if (!raw || typeof raw !== "object") return {};

  const out: DeepPartial<AiMindmapStream> = {};
  if (typeof raw.title === "string" && raw.title.trim()) {
    out.title = raw.title.trim().slice(0, AI_LIMITS.MAX_TITLE_CHARS);
  }
  if (raw.recommendedStructure && STREAM_STRUCTURES.has(raw.recommendedStructure)) {
    out.recommendedStructure = raw.recommendedStructure;
  }
  if (raw.recommendedPalette && STREAM_PALETTES.has(raw.recommendedPalette)) {
    out.recommendedPalette = raw.recommendedPalette;
  }

  let totalNodes = 0;

  const walk = (node: DeepPartial<AiTopicNode> | undefined, depth: number): DeepPartial<AiTopicNode> | undefined => {
    if (!node || typeof node !== "object") return undefined;
    if (totalNodes >= AI_LIMITS.MAX_NODES || depth > AI_LIMITS.MAX_DEPTH) return undefined;
    totalNodes += 1;

    const clean: DeepPartial<AiTopicNode> = {};
    if (typeof node.title === "string") {
      const trimmed = node.title.trim().slice(0, AI_LIMITS.MAX_TITLE_CHARS);
      if (trimmed) clean.title = trimmed;
    }
    if (typeof node.subtitle === "string") {
      const sub = node.subtitle.trim().slice(0, AI_LIMITS.MAX_SUBTITLE_CHARS);
      if (sub) clean.subtitle = sub;
    }
    if (node.task === "todo" || node.task === "done") {
      clean.task = node.task;
    }
    if (Array.isArray(node.labels)) {
      const labels = node.labels
        .filter((l): l is string => typeof l === "string" && l.trim().length > 0)
        .map((l) => l.trim().slice(0, AI_LIMITS.MAX_LABEL_CHARS))
        .slice(0, AI_LIMITS.MAX_LABELS);
      if (labels.length > 0) clean.labels = labels;
    }
    if (Array.isArray(node.children) && depth < AI_LIMITS.MAX_DEPTH) {
      const children: Array<DeepPartial<AiTopicNode> | undefined> = [];
      for (const child of node.children.slice(0, AI_LIMITS.MAX_CHILDREN_PER_NODE)) {
        if (totalNodes >= AI_LIMITS.MAX_NODES) break;
        const next = walk(child, depth + 1);
        if (next && (next.title || next.children?.length)) {
          children.push(next);
        }
      }
      if (children.length > 0) clean.children = children;
    }
    return clean;
  };

  if (raw.root) {
    out.root = walk(raw.root, 0);
  }
  return out;
}

/**
 * Best-effort parser for streaming JSON objects (tolerates markdown code fences
 * and incomplete trailing strings/brackets/commas).
 */
export function parsePartialJson(rawText: string): unknown | null {
  let text = rawText.trim();
  if (!text) return null;

  const fenceStart = text.indexOf("```");
  if (fenceStart !== -1) {
    const afterFence = text.slice(fenceStart + 3);
    const newline = afterFence.indexOf("\n");
    text = newline !== -1 ? afterFence.slice(newline + 1) : afterFence;
    const fenceEnd = text.lastIndexOf("```");
    if (fenceEnd !== -1) text = text.slice(0, fenceEnd);
    text = text.trim();
  }

  const objStart = text.indexOf("{");
  if (objStart === -1) return null;
  text = text.slice(objStart);

  try {
    return JSON.parse(text);
  } catch {
    // Attempt best-effort repair for truncated streaming JSON
  }

  let inString = false;
  let escape = false;
  const stack: string[] = [];

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === "\\" && inString) {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (!inString) {
      if (ch === "{") stack.push("}");
      else if (ch === "[") stack.push("]");
      else if ((ch === "}" || ch === "]") && stack[stack.length - 1] === ch) {
        stack.pop();
      }
    }
  }

  let repaired = text;
  if (escape) repaired = repaired.slice(0, -1);
  if (inString) repaired += '"';

  // Trim dangling key-value separators or trailing commas outside strings
  repaired = repaired
    .replace(/,\s*$/, "")
    .replace(/:\s*$/, ": null")
    .replace(/,\s*"[^"]*"\s*$/, "");

  while (stack.length > 0) {
    repaired = repaired.replace(/,\s*$/, "");
    repaired += stack.pop();
  }

  try {
    return JSON.parse(repaired);
  } catch {
    return null;
  }
}
