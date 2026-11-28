import { describe, expect, it } from "vitest";
import { richTextToPlainText, validateDocumentInvariants } from "@mindmap/core/model";
import { readAttachment, withAttachments } from "../src/composer-attachments.js";
import { documentFromTopic } from "../src/outline.js";
import { webpagePassages } from "../src/source-material.js";

describe("composer files", () => {
  it("keeps citations, file order, template and original document when combining sources", async () => {
    const markdown = await readAttachment(new File(["# Plan\r\nKeep this quote."], "Meeting.MD"), "en");
    const text = await readAttachment(new File(["决定"], "notes.txt", { type: "text/plain" }), "zh");
    const base = documentFromTopic("Review", "blank-organic");
    const combined = withAttachments(base, [markdown, text], "en");
    const [meeting, notes] = combined.sheets[0].rootTopic.children;
    expect([meeting, notes].map((topic) => richTextToPlainText(topic.title))).toEqual(["Meeting.MD", "notes.txt"]);
    expect(meeting.children[0].note?.text).toBe("Meeting.MD · Lines 1–2\n\n# Plan\nKeep this quote.");
    expect(base.sheets[0].rootTopic.children).toEqual([]);
    expect(combined.theme).toEqual(base.theme);
    expect(validateDocumentInvariants(combined)).toEqual([]);
  });
  it("keeps webpage metadata out of group titles, notes and links when mixing sources", async () => {
    const passages = webpagePassages(["A useful finding"]);
    const text = await readAttachment(new File(["Manual notes"], "notes.txt"), "en");
    const combined = withAttachments(documentFromTopic("Review", "blank-organic"), [
      { kind: "source", origin: "web", name: "Publisher bulletin", address: "https://publisher.test/article", title: passages[0].title, passages }, text,
    ], "en");
    const [article, notes] = combined.sheets[0].rootTopic.children;
    expect(richTextToPlainText(article.title)).toBe("A useful finding");
    expect(article.children[0].note?.text).toBe("A useful finding");
    expect(notes.children[0].note?.text).toBe("notes.txt · Line 1\n\nManual notes");
    expect(JSON.stringify(combined)).not.toMatch(/Publisher bulletin|publisher\.test|Paragraph 1/);
  });
  it("rejects unsupported, empty, binary and oversized inputs rather than attaching a filename", async () => {
    for (const [file, error] of [
      [new File(["x"], "book.docx"), /Unsupported/],
      [new File([" \n"], "empty.txt"), /passage/],
      [new File([new Uint8Array([255])], "binary.txt"), /UTF-8/],
      [new File(["\0"], "nul.md"), /UTF-8/],
      [new File(["x".repeat(16_001)], "long.txt"), /16,000/],
    ] as const) await expect(readAttachment(file, "en")).rejects.toThrow(error);
  });
});
