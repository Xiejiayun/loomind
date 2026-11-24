import { describe, expect, it } from "vitest";
import {
  exportToMarkdown,
  exportToOpml,
  exportToXMind,
  getTemplate,
  importFromMarkdown,
  importFromOpml,
  importFromXMind,
  richTextToPlainText,
  serializeToSvg,
} from "../src/index.js";

describe("@mindmap/core I/O codecs", () => {
  it("round-trips .xmind zip archive losslessly for topics, notes, and summaries", () => {
    const original = getTemplate("reading-notes").create();
    const zipBytes = exportToXMind(original);
    expect(zipBytes.byteLength).toBeGreaterThan(100);

    const imported = importFromXMind(zipBytes);
    expect(imported.sheets).toHaveLength(1);
    expect(richTextToPlainText(imported.sheets[0].rootTopic.title)).toBe("《思考，快与慢》");
    expect(imported.sheets[0].rootTopic.children).toHaveLength(3);
    expect(imported.sheets[0].rootTopic.children[1].note?.text).toContain("系统一");
  });

  it("round-trips Markdown with tasks and notes", () => {
    const okr = getTemplate("quarterly-okr").create();
    const md = exportToMarkdown(okr);
    expect(md).toContain("[x] KR1");
    expect(md).toContain("[ ] KR2");

    const parsed = importFromMarkdown(md);
    expect(richTextToPlainText(parsed.sheets[0].rootTopic.title)).toBe("Q3 增长目标");
    expect(parsed.sheets[0].rootTopic.children[0].children[0].task?.status).toBe("done");
    expect(parsed.sheets[0].rootTopic.children[0].children[1].task?.status).toBe("todo");
  });

  it("round-trips OPML 2.0", () => {
    const doc = getTemplate("blank-organic").create();
    const opml = exportToOpml(doc);
    expect(opml).toContain('<opml version="2.0">');

    const imported = importFromOpml(opml);
    expect(richTextToPlainText(imported.sheets[0].rootTopic.title)).toBe("中心主题");
    expect(imported.sheets[0].rootTopic.children).toHaveLength(4);
  });

  it("serializes pure vector SVG with zero foreignObject and native text/tspan", () => {
    const doc = getTemplate("blank-organic").create();
    const svg = serializeToSvg(doc);
    expect(svg).toContain("<svg");
    expect(svg).toContain("<text");
    expect(svg).toContain("<tspan");
    expect(svg).not.toContain("foreignObject");
  });
});
