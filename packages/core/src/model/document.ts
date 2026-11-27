export type MindmapStructure =
  | "mindmap"
  | "logic"
  | "org"
  | "brace"
  | "indented"
  | "timeline"
  | "fishbone"
  | "treeTable"
  | "matrix";

export type TopicShape =
  | "auto"
  | "rounded"
  | "pill"
  | "capsule"
  | "underline"
  | "diamond"
  | "hexagon"
  | "cloud";

export type SkeletonId =
  | "xmind-organic"
  | "classic-cards"
  | "minimal-pill"
  | "editorial-underline"
  | "technical-elbow";

export type PaletteId =
  | "xmind-rainbow"
  | "aurora"
  | "warm-paper"
  | "midnight-neon"
  | "obsidian-gold"
  | "minimal-ink"
  | "workspace"
  | "prism-vibrant"
  | "forest-calm"
  | "sunset-coral"
  | "blueprint";

export interface RichTextMark {
  type: "bold" | "italic" | "strike" | "code" | "textStyle" | "highlight" | "link";
  attrs?: {
    color?: string; // 8-digit uppercase hex RGBA, e.g. "#EF4444FF"
    backgroundColor?: string;
    href?: string;
  };
}

export interface RichTextNode {
  type: "text";
  text: string;
  marks?: RichTextMark[];
}

export interface RichTextParagraph {
  type: "paragraph";
  content?: RichTextNode[];
}

/** TipTap / ProseMirror deterministic compact JSON document */
export interface RichTextDoc {
  type: "doc";
  content: RichTextParagraph[];
}

export interface TopicStyleOverride {
  fillColor?: string; // "#RRGGBBAA"
  strokeColor?: string;
  strokeWidth?: number; // 0..8
  strokeDash?: "solid" | "dashed" | "dotted";
  textColor?: string;
  fontSize?: number; // 10..48
  fontWeight?: 400 | 500 | 600 | 700;
  cornerRadius?: number;
}

export interface MindmapCallout {
  id: string;
  title: RichTextDoc;
  style?: TopicStyleOverride;
}

export interface MindmapTopic {
  id: string; // ^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$
  title: RichTextDoc;
  subtitle?: string;
  structure?: MindmapStructure;
  direction?: "auto" | "left" | "right" | "up" | "down";
  collapsed?: boolean;
  shape?: TopicShape;
  style?: TopicStyleOverride;

  /** Freeform positioning & custom sizing */
  manualOffset?: { dx: number; dy: number };
  customWidth?: number; // 80..640
  floatingPos?: { x: number; y: number }; // Only valid on floatingTopics roots

  /** Rich XMind elements */
  markers?: string[]; // e.g. ["priority:1", "progress:half", "flag:red"]
  stickerId?: string; // e.g. "rocket", "lightbulb"
  labels?: string[]; // max 6, each <= 24 chars
  task?: { status: "todo" | "done" };
  callout?: MindmapCallout;
  note?: { format: "markdown"; text: string };
  href?: { kind: "url" | "topic" | "sheet"; target: string; label?: string };
  equation?: { latex: string };
  image?: { resourceId: string; width: number; height: number; pos: "top" | "left" | "right" };

  children: MindmapTopic[];
}

export interface MindmapBoundary {
  id: string;
  target:
    | { kind: "subtree"; topicId: string }
    | { kind: "range"; parentId: string; startIndex: number; endIndex: number };
  shape: "rounded" | "cloud" | "bracket" | "waves";
  title?: string;
  style?: { fillColor?: string; strokeColor?: string; badgeColor?: string };
}

export interface MindmapSummary {
  id: string;
  parentId: string;
  startIndex: number;
  endIndex: number; // 0 <= startIndex <= endIndex < parent.children.length
  brace: "curly" | "bracket" | "angled" | "round";
  topic: MindmapTopic; // Full Topic supporting child branches
}

export interface MindmapRelationship {
  id: string;
  fromId: string;
  toId: string;
  title?: string;
  control1Offset?: { dx: number; dy: number };
  control2Offset?: { dx: number; dy: number };
  style?: { strokeColor?: string; strokeWidth?: number; dash?: "dashed" | "solid" | "dotted" };
}

export interface MindmapThemeConfig {
  skeletonId: SkeletonId;
  paletteId: PaletteId;
  handdrawn: boolean;
  rainbowBranches: boolean;
}

export interface MindmapSheet {
  id: string;
  title: string;
  structure: MindmapStructure;
  direction: "bilateral" | "leftRight" | "rightLeft" | "topDown" | "bottomUp";
  spacing: "compact" | "balanced" | "spacious";
  theme?: Partial<MindmapThemeConfig>;
  rootTopic: MindmapTopic;
  floatingTopics: MindmapTopic[];
  boundaries: MindmapBoundary[];
  summaries: MindmapSummary[];
  relationships: MindmapRelationship[];
}

export interface InlineAsset {
  resourceId: string;
  mimeType: "image/png" | "image/jpeg" | "image/webp" | "image/svg+xml";
  width: number;
  height: number;
  sha256: string;
  dataBase64: string; // <= 3 MiB
}

export interface MindmapDocument {
  format: "mindmap-document";
  version: 1;
  activeSheetId: string;
  theme: MindmapThemeConfig;
  sheets: MindmapSheet[];
  assets: Record<string, InlineAsset>;
  deletedIds: string[]; // Monotonic identity ledger
}

export function createRichText(text: string): RichTextDoc {
  const lines = text.split("\n");
  return {
    type: "doc",
    content: lines.map((line) => ({
      type: "paragraph",
      ...(line.length > 0 ? { content: [{ type: "text", text: line }] } : {}),
    })),
  };
}

export function richTextToPlainText(doc: RichTextDoc): string {
  return doc.content
    .map((p) => (p.content ? p.content.map((n) => n.text).join("") : ""))
    .join("\n");
}

export function normalizeHexColor(input: string): string {
  const trimmed = input.trim().toUpperCase();
  if (/^#[0-9A-F]{8}$/.test(trimmed)) return trimmed;
  if (/^#[0-9A-F]{6}$/.test(trimmed)) return `${trimmed}FF`;
  if (/^#[0-9A-F]{3}$/.test(trimmed)) {
    const [, r, g, b] = trimmed;
    return `#${r}${r}${g}${g}${b}${b}FF`;
  }
  if (/^#[0-9A-F]{4}$/.test(trimmed)) {
    const [, r, g, b, a] = trimmed;
    return `#${r}${r}${g}${g}${b}${b}${a}${a}`;
  }
  return "#0F172AFF";
}

export function quantizeCoord(v: number): number {
  return Math.round(v * 10) / 10;
}

let idCounter = 0;

export function generateId(prefix = "t", deletedIds?: ReadonlySet<string>): string {
  let candidate: string;
  do {
    idCounter += 1;
    const rand = Math.random().toString(36).slice(2, 7);
    candidate = `${prefix}-${Date.now().toString(36)}-${idCounter.toString(36)}${rand}`;
  } while (deletedIds?.has(candidate));
  return candidate;
}

export function createTopic(
  id: string,
  title: string | RichTextDoc,
  partial?: Partial<Omit<MindmapTopic, "id" | "title">>,
): MindmapTopic {
  return {
    id,
    title: typeof title === "string" ? createRichText(title) : title,
    children: [],
    ...partial,
  };
}

export const DEFAULT_THEME_CONFIG: MindmapThemeConfig = {
  skeletonId: "xmind-organic",
  paletteId: "workspace",
  handdrawn: false,
  rainbowBranches: true,
};

export function createSheet(
  id: string,
  title: string,
  rootTopic?: MindmapTopic,
  partial?: Partial<Omit<MindmapSheet, "id" | "title" | "rootTopic">>,
): MindmapSheet {
  return {
    id,
    title,
    structure: "mindmap",
    direction: "bilateral",
    spacing: "balanced",
    rootTopic:
      rootTopic ??
      createTopic(`${id}-root`, title, {
        children: [
          createTopic(`${id}-b1`, "分支主题 1"),
          createTopic(`${id}-b2`, "分支主题 2"),
          createTopic(`${id}-b3`, "分支主题 3"),
        ],
      }),
    floatingTopics: [],
    boundaries: [],
    summaries: [],
    relationships: [],
    ...partial,
  };
}

export function createDocument(sheets?: MindmapSheet[], theme?: Partial<MindmapThemeConfig>): MindmapDocument {
  const finalSheets = sheets && sheets.length > 0 ? sheets : [createSheet("sheet-1", "中心主题")];
  return {
    format: "mindmap-document",
    version: 1,
    activeSheetId: finalSheets[0].id,
    theme: { ...DEFAULT_THEME_CONFIG, ...theme },
    sheets: finalSheets,
    assets: {},
    deletedIds: [],
  };
}
