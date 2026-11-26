import { describe, expect, it } from "vitest";
import {
  exportToOpml,
  getTemplate,
  importFromOpml,
  MindmapDocumentSchema,
  richTextToPlainText,
  validateDocumentInvariants,
} from "../src/index.js";

describe("T6 OPML import multi-root preservation & validation", () => {
  it("preserves single-root round-trip and does NOT overwrite single-root text when <head><title> differs", () => {
    const doc = getTemplate("blank-organic").create();
    const exported = exportToOpml(doc);
    const roundTripped = importFromOpml(exported);
    expect(MindmapDocumentSchema.safeParse(roundTripped).success).toBe(true);
    expect(validateDocumentInvariants(roundTripped)).toEqual([]);
    expect(richTextToPlainText(roundTripped.sheets[0].rootTopic.title)).toBe("中心主题");

    const singleWithDifferentHead = `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <head><title>Document Header Title</title></head>
  <body>
    <outline text="Actual Root Title">
      <outline text="Child 1" />
    </outline>
  </body>
</opml>`;
    const imported = importFromOpml(singleWithDifferentHead);
    expect(richTextToPlainText(imported.sheets[0].rootTopic.title)).toBe("Actual Root Title");
    expect(imported.sheets[0].rootTopic.children).toHaveLength(1);
    expect(validateDocumentInvariants(imported)).toEqual([]);
  });

  it("preserves multiple top-level outlines in order under <head><title> synthetic root", () => {
    const multiWithHead = `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <head><title>Project Plan &amp; Goals</title></head>
  <body>
    <outline text="Phase 1" _note="First phase&#10;line 2">
      <outline text="Task A" />
      <outline text="Task B" />
    </outline>
    <outline text='Phase 2 &lt;Beta&gt;' _note='Quotes &quot;ok&quot; &amp; &apos;single&apos;'>
      <outline text='Sub 2.1' />
    </outline>
    <outline text="Phase 3" />
  </body>
</opml>`;

    const imported = importFromOpml(multiWithHead);
    expect(MindmapDocumentSchema.safeParse(imported).success).toBe(true);
    expect(validateDocumentInvariants(imported)).toEqual([]);

    const root = imported.sheets[0].rootTopic;
    expect(richTextToPlainText(root.title)).toBe("Project Plan & Goals");
    expect(root.children.map((c) => richTextToPlainText(c.title))).toEqual([
      "Phase 1",
      "Phase 2 <Beta>",
      "Phase 3",
    ]);
    expect(root.children[0].note?.text).toBe("First phase\nline 2");
    expect(root.children[0].children.map((c) => richTextToPlainText(c.title))).toEqual(["Task A", "Task B"]);
    expect(root.children[1].note?.text).toBe('Quotes "ok" & \'single\'');
    expect(root.children[1].children.map((c) => richTextToPlainText(c.title))).toEqual(["Sub 2.1"]);
  });

  it("uses fixed default synthetic root title when multiple top-level outlines lack <head><title>", () => {
    const multiNoHead = `<opml version="2.0"><body><outline text="Alpha" /><outline text="Beta" /></body></opml>`;
    const imported = importFromOpml(multiNoHead);
    expect(MindmapDocumentSchema.safeParse(imported).success).toBe(true);
    expect(validateDocumentInvariants(imported)).toEqual([]);
    expect(richTextToPlainText(imported.sheets[0].rootTopic.title)).toBe("OPML 导入");
    expect(imported.sheets[0].rootTopic.children.map((c) => richTextToPlainText(c.title))).toEqual([
      "Alpha",
      "Beta",
    ]);
  });

  it("throws explicit errors on empty, zero-outline, or malformed/unbalanced OPML", () => {
    expect(() => importFromOpml("")).toThrow(/empty/i);
    expect(() => importFromOpml("<opml><body></body></opml>")).toThrow(/no <outline>/i);
    expect(() => importFromOpml('<opml><body><outline text="Unclosed"></body></opml>')).toThrow(/unclosed/i);
    expect(() => importFromOpml("<opml><body></outline></body></opml>")).toThrow(/unexpected closing/i);
  });
});
