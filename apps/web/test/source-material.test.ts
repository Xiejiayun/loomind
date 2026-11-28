import { describe, expect, it } from "vitest";
import { MindmapDocumentSchema, richTextToPlainText, validateDocumentInvariants } from "@mindmap/core/model";
import { contentFromSource, documentFromSource, passageLocation, SOURCE_PASSAGE_LIMIT, SOURCE_TEXT_LIMIT, sourceAddress, sourcePassages, webpagePassages } from "../src/source-material.js";

describe("source-linked map creation", () => {
  it("previews paragraph numbers but keeps only the webpage's unmodified prose", () => {
    const quote = "审议通过。".repeat(24) + "原文链接 https://author.example/。";
    const passages = webpagePassages(["第一条结论。", quote]);
    const url = "https://example.test/article";
    const content = contentFromSource({ origin: "web", name: "正式公报", address: url, passages }, "zh");
    const topic = content.children[1];
    expect(richTextToPlainText(topic.title)).toHaveLength(72);
    expect(topic.note?.text).toBe(quote);
    expect(content.href).toBeUndefined(); expect(topic.href).toBeUndefined();
    expect(JSON.stringify(content)).not.toMatch(/正式公报|example\.test|正文第 2 段/);
    expect(passageLocation(passages[1], "en")).toBe("Paragraph 2");
  });
  it("previews the PDF page without writing it into notes or stripping a user-supplied link", () => {
    const passage = { title: "结论", quote: "结论：保持既定日期。", page: 5, firstLine: 1, lastLine: 1 };
    const content = contentFromSource({ origin: "pdf", name: "会议原件.pdf", address: "https://example.test/a.pdf", passages: [passage] }, "zh");
    expect(content.children[0].note?.text).toBe("会议原件.pdf · https://example.test/a.pdf\n\n结论：保持既定日期。");
    expect(JSON.stringify(content)).not.toMatch(/第 5 页|"page"/);
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
