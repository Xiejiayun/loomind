import { describe, expect, it } from "vitest";
import {
  createDocument,
  LocalImmerSyncAdapter,
  MindmapDocumentSchema,
  validateDocumentInvariants,
} from "../src/index.js";
import { LoroSyncAdapter } from "../src/store/loro-adapter.js";

describe("relationship/upsert color normalization", () => {
  it("normalizes 6-digit, lowercase, 3-digit, and invalid strokeColor across adapters", () => {
    const base = createDocument();
    const sheetId = base.sheets[0].id;
    const [b1, b2] = base.sheets[0].rootTopic.children;

    const cases: Array<{ id: string; input: string; expected: string }> = [
      { id: "rel-6", input: "#3b82f6", expected: "#3B82F6FF" },
      { id: "rel-8", input: "#3b82f680", expected: "#3B82F680" },
      { id: "rel-3", input: "#f0a", expected: "#FF00AAFF" },
      { id: "rel-invalid", input: "not-a-color", expected: "#0F172AFF" },
    ];

    const local = new LocalImmerSyncAdapter(base);
    const loro = new LoroSyncAdapter(base);

    for (const c of cases) {
      const cmd = {
        type: "relationship/upsert" as const,
        sheetId,
        relationship: {
          id: c.id,
          fromId: b1.id,
          toId: b2.id,
          style: { strokeColor: c.input, strokeWidth: 2, dash: "dashed" as const },
        },
      };
      local.applyCommand(cmd);
      loro.applyCommand(cmd);
    }

    for (const doc of [local.getDocument(), loro.getDocument()]) {
      expect(MindmapDocumentSchema.safeParse(doc).success).toBe(true);
      expect(validateDocumentInvariants(doc)).toEqual([]);
      for (const c of cases) {
        const rel = doc.sheets[0].relationships.find((r) => r.id === c.id);
        expect(rel?.style?.strokeColor).toBe(c.expected);
      }
    }
  });
});
