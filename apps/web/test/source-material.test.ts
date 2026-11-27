import { describe, expect, it } from "vitest";
import { MindmapDocumentSchema, richTextToPlainText, validateDocumentInvariants } from "@mindmap/core/model";
import { documentFromPassages, documentFromSource, passageLocation, SOURCE_PASSAGE_LIMIT, SOURCE_TEXT_LIMIT, sourceAddress, sourcePassages } from "../src/source-material.js";

describe("source-linked map creation", () => {
  it("keeps the physical PDF page and original filename even when the map name changes", () => {
    const passage = { title: "结论", quote: "结论：保持既定日期。", page: 5, firstLine: 1, lastLine: 1 };
    const doc = documentFromPassages("团队评审", [passage], "https://example.test/a.pdf", "zh", "会议原件.pdf");
    expect(doc.sheets[0].rootTopic.children[0].note?.text).toBe("会议原件.pdf · 第 5 页 · https://example.test/a.pdf\n\n结论：保持既定日期。");
    expect(passageLocation(passage, "en")).toBe("Page 5");
    expect(passageLocation({ ...passage, page: undefined }, "en")).toBe("Line 1");
  });
  it("preserves source lines and citation text while shortening only the visible node title", () => {
    const long = "研究资料".repeat(30);
    const text = `\r\n- 上线日期\r\n  确认礼拜五。  \r\n\r\n1、${long}\r\n2.5 天用于复核。`;
    const doc = documentFromSource("  会议纪要  ", text, "https://example.test/notes#agenda", "zh");
    expect(MindmapDocumentSchema.safeParse(doc).success).toBe(true);
    expect(validateDocumentInvariants(doc)).toEqual([]);
    const [launch, research] = doc.sheets[0].rootTopic.children;
    expect(richTextToPlainText(launch.title)).toBe("上线日期");
    expect(launch.note?.text).toBe("会议纪要 · 第 2–3 行 · https://example.test/notes#agenda\n\n- 上线日期\n  确认礼拜五。  ");
    expect(research.note?.text).toContain(`第 5–6 行 · https://example.test/notes#agenda\n\n1、${long}\n2.5 天用于复核。`);
    expect(richTextToPlainText(research.title)).toHaveLength(72);
    expect(research.href?.target).toBe("https://example.test/notes#agenda");
    expect(launch.id).not.toBe(research.id);
  });
  it("reports unsupported input instead of silently omitting sources or importing a URL", () => {
    expect(sourcePassages("\t\n", "en")).toEqual([]);
    expect(() => documentFromSource("Notes", "\t", "", "en")).toThrow(/Paste a passage/);
    expect(() => documentFromSource("", "One passage", "", "en")).toThrow(/source title/);
    expect(sourceAddress("", "en")).toBeUndefined();
    expect(() => sourceAddress("file:///local/notes", "en")).toThrow(/HTTP/);
    expect(() => sourceAddress("https://someone@example.test/notes", "en")).toThrow(/credentials/);
    expect(() => sourcePassages("x".repeat(SOURCE_TEXT_LIMIT + 1), "en")).toThrow(/16,000/);
    expect(() => sourcePassages("- one\n".repeat(SOURCE_PASSAGE_LIMIT + 1), "en")).toThrow(/80/);
    expect(documentFromSource("Notes", "- one", "", "en").sheets[0].rootTopic.children[0].note?.text).toBe("Notes · Line 1\n\n- one");
  });
});
