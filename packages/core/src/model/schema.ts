import { z } from "zod";
import type { MindmapDocument, MindmapTopic } from "./document.js";

const IdRegex = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;
const HexColorRegex = /^#[0-9A-F]{8}$/;

export const IdSchema = z.string().regex(IdRegex, "Invalid ID format");
export const HexColorSchema = z.string().regex(HexColorRegex, "Must be 8-digit uppercase hex RGBA");

export const MindmapStructureSchema = z.enum([
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

export const TopicShapeSchema = z.enum([
  "auto",
  "rounded",
  "pill",
  "capsule",
  "underline",
  "diamond",
  "hexagon",
  "cloud",
]);

export const SkeletonIdSchema = z.enum([
  "xmind-organic",
  "classic-cards",
  "minimal-pill",
  "editorial-underline",
  "technical-elbow",
]);

export const PaletteIdSchema = z.enum([
  "xmind-rainbow",
  "aurora",
  "warm-paper",
  "midnight-neon",
  "obsidian-gold",
  "minimal-ink",
  "workspace",
  "prism-vibrant",
  "forest-calm",
  "sunset-coral",
  "blueprint",
]);

export const RichTextMarkSchema = z.object({
  type: z.enum(["bold", "italic", "strike", "code", "textStyle", "highlight", "link"]),
  attrs: z
    .object({
      color: HexColorSchema.optional(),
      backgroundColor: HexColorSchema.optional(),
      href: z.string().optional(),
    })
    .optional(),
});

export const RichTextNodeSchema = z.object({
  type: z.literal("text"),
  text: z.string(),
  marks: z.array(RichTextMarkSchema).optional(),
});

export const RichTextParagraphSchema = z.object({
  type: z.literal("paragraph"),
  content: z.array(RichTextNodeSchema).optional(),
});

export const RichTextDocSchema = z.object({
  type: z.literal("doc"),
  content: z.array(RichTextParagraphSchema).min(1),
});

export const TopicStyleOverrideSchema = z.object({
  fillColor: HexColorSchema.optional(),
  strokeColor: HexColorSchema.optional(),
  strokeWidth: z.number().min(0).max(8).optional(),
  strokeDash: z.enum(["solid", "dashed", "dotted"]).optional(),
  textColor: HexColorSchema.optional(),
  fontSize: z.number().min(10).max(48).optional(),
  fontWeight: z.union([z.literal(400), z.literal(500), z.literal(600), z.literal(700)]).optional(),
  cornerRadius: z.number().min(0).max(9999).optional(),
});

export const MindmapCalloutSchema = z.object({
  id: IdSchema,
  title: RichTextDocSchema,
  style: TopicStyleOverrideSchema.optional(),
});

export const MindmapTopicSchema: z.ZodType<MindmapTopic> = z.lazy(() =>
  z.object({
    id: IdSchema,
    title: RichTextDocSchema,
    subtitle: z.string().optional(),
    structure: MindmapStructureSchema.optional(),
    direction: z.enum(["auto", "left", "right", "up", "down"]).optional(),
    collapsed: z.boolean().optional(),
    shape: TopicShapeSchema.optional(),
    style: TopicStyleOverrideSchema.optional(),
    manualOffset: z.object({ dx: z.number(), dy: z.number() }).optional(),
    customWidth: z.number().min(80).max(640).optional(),
    floatingPos: z.object({ x: z.number(), y: z.number() }).optional(),
    markers: z.array(z.string()).optional(),
    stickerId: z.string().optional(),
    labels: z.array(z.string().max(24)).max(6).optional(),
    task: z.object({ status: z.enum(["todo", "done"]) }).optional(),
    callout: MindmapCalloutSchema.optional(),
    note: z.object({ format: z.literal("markdown"), text: z.string() }).optional(),
    href: z
      .object({
        kind: z.enum(["url", "topic", "sheet"]),
        target: z.string(),
        label: z.string().optional(),
      })
      .optional(),
    equation: z.object({ latex: z.string() }).optional(),
    image: z
      .object({
        resourceId: z.string(),
        width: z.number().positive(),
        height: z.number().positive(),
        pos: z.enum(["top", "left", "right"]),
      })
      .optional(),
    children: z.array(MindmapTopicSchema),
  }),
);

export const MindmapBoundarySchema = z.object({
  id: IdSchema,
  target: z.union([
    z.object({ kind: z.literal("subtree"), topicId: IdSchema }),
    z.object({
      kind: z.literal("range"),
      parentId: IdSchema,
      startIndex: z.number().int().min(0),
      endIndex: z.number().int().min(0),
    }),
  ]),
  shape: z.enum(["rounded", "cloud", "bracket", "waves"]),
  title: z.string().optional(),
  style: z
    .object({
      fillColor: HexColorSchema.optional(),
      strokeColor: HexColorSchema.optional(),
      badgeColor: HexColorSchema.optional(),
    })
    .optional(),
});

export const MindmapSummarySchema = z.object({
  id: IdSchema,
  parentId: IdSchema,
  startIndex: z.number().int().min(0),
  endIndex: z.number().int().min(0),
  brace: z.enum(["curly", "bracket", "angled", "round"]),
  topic: MindmapTopicSchema,
});

export const MindmapRelationshipSchema = z.object({
  id: IdSchema,
  fromId: IdSchema,
  toId: IdSchema,
  title: z.string().optional(),
  control1Offset: z.object({ dx: z.number(), dy: z.number() }).optional(),
  control2Offset: z.object({ dx: z.number(), dy: z.number() }).optional(),
  style: z
    .object({
      strokeColor: HexColorSchema.optional(),
      strokeWidth: z.number().min(0.5).max(8).optional(),
      dash: z.enum(["dashed", "solid", "dotted"]).optional(),
    })
    .optional(),
});

export const MindmapThemeConfigSchema = z.object({
  skeletonId: SkeletonIdSchema,
  paletteId: PaletteIdSchema,
  handdrawn: z.boolean(),
  rainbowBranches: z.boolean(),
});

export const MindmapSheetSchema = z.object({
  id: IdSchema,
  title: z.string(),
  structure: MindmapStructureSchema,
  direction: z.enum(["bilateral", "leftRight", "rightLeft", "topDown", "bottomUp"]),
  spacing: z.enum(["compact", "balanced", "spacious"]),
  theme: MindmapThemeConfigSchema.partial().optional(),
  rootTopic: MindmapTopicSchema,
  floatingTopics: z.array(MindmapTopicSchema),
  boundaries: z.array(MindmapBoundarySchema),
  summaries: z.array(MindmapSummarySchema),
  relationships: z.array(MindmapRelationshipSchema),
});

export const InlineAssetSchema = z.object({
  resourceId: z.string(),
  mimeType: z.enum(["image/png", "image/jpeg", "image/webp", "image/svg+xml"]),
  width: z.number().positive(),
  height: z.number().positive(),
  sha256: z.string(),
  dataBase64: z.string(),
});

export const MindmapDocumentSchema: z.ZodType<MindmapDocument> = z.object({
  format: z.literal("mindmap-document"),
  version: z.literal(1),
  activeSheetId: IdSchema,
  theme: MindmapThemeConfigSchema,
  sheets: z.array(MindmapSheetSchema).min(1),
  assets: z.record(InlineAssetSchema),
  deletedIds: z.array(z.string()),
});

export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value as Record<string, unknown>).sort()) {
      const v = (value as Record<string, unknown>)[k];
      if (v !== undefined) out[k] = sortKeys(v);
    }
    return out;
  }
  return value;
}
