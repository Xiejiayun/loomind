import { z } from "zod";

export interface AiTopicNode {
  title: string;
  subtitle?: string;
  task?: "todo" | "done";
  labels?: string[];
  markers?: string[];
  children?: AiTopicNode[];
}

export const AiTopicSchema: z.ZodType<AiTopicNode> = z.lazy(() =>
  z.object({
    title: z.string().min(1).max(120),
    subtitle: z.string().optional(),
    task: z.enum(["todo", "done"]).optional(),
    labels: z.array(z.string().max(18)).max(3).optional(),
    markers: z.array(z.string()).max(2).optional(),
    children: z.array(AiTopicSchema).optional(),
  }),
);

export const AiPlanSchema = z.object({
  goal: z.string(),
  approach: z.string().optional(),
  steps: z.array(z.string()),
});

export const AiMindmapStreamSchema = z.object({
  plan: AiPlanSchema.optional(),
  title: z.string(),
  recommendedStructure: z.enum([
    "mindmap",
    "logic",
    "org",
    "brace",
    "timeline",
    "fishbone",
    "treeTable",
  ]),
  recommendedPalette: z.enum([
    "xmind-rainbow",
    "aurora",
    "warm-paper",
    "midnight-neon",
    "forest-calm",
  ]),
  root: AiTopicSchema,
});

export type AiMindmapStream = z.infer<typeof AiMindmapStreamSchema>;

export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends Array<infer U>
    ? Array<DeepPartial<U> | undefined>
    : T[K] extends object | undefined
      ? DeepPartial<NonNullable<T[K]>>
      : T[K];
};
