import { describe, expect, it } from "vitest";
import {
  collectAllTopics,
  createDocument,
  createSheet,
  createTopic,
  LayoutEngine,
} from "@mindmap/core";
import { buildSelectionAnnouncement, buildTopicAriaLabel } from "../src/canvas/a11y.js";
import { getEditorMessages } from "../src/i18n.js";

describe("canvas accessibility ARIA helpers", () => {
  it("builds descriptive topic ARIA labels in English and Chinese", () => {
    const root = createTopic("root", "Product Launch", {
      children: [
        createTopic("b1", "Engineering", {
          collapsed: true,
          note: { format: "markdown", text: "Checklist" },
          href: { kind: "url", target: "https://example.com" },
          children: [
            createTopic("b1-1", "API", { task: { status: "done" } }),
            createTopic("b1-2", "UI", { task: { status: "todo" } }),
          ],
        }),
        createTopic("b2", "Marketing", { task: { status: "done" } }),
      ],
    });
    const sheet = createSheet("s1", "Launch", root);
    const doc = createDocument([sheet]);
    const layout = new LayoutEngine().compute(doc, "s1");

    const en = getEditorMessages("en").a11y;
    const zh = getEditorMessages("zh").a11y;

    const b1Node = layout.nodes.get("b1")!;
    const enLabel = buildTopicAriaLabel(root.children[0], b1Node, en);
    expect(enLabel).toContain("Engineering");
    expect(enLabel).toContain("level 2");
    expect(enLabel).toContain("1 of 2 tasks completed");
    expect(enLabel).toContain("collapsed, 2 hidden subtopics");
    expect(enLabel).toContain("has note");
    expect(enLabel).toContain("has link");

    const zhLabel = buildTopicAriaLabel(root.children[1], layout.nodes.get("b2")!, zh);
    expect(zhLabel).toContain("Marketing");
    expect(zhLabel).toContain("第 2 层");
    expect(zhLabel).toContain("已完成任务");
  });

  it("announces single and multi-topic selection for screen readers", () => {
    const root = createTopic("root", "Root", {
      children: [createTopic("a", "Alpha"), createTopic("b", "Beta")],
    });
    const sheet = createSheet("s1", "Sheet", root);
    const doc = createDocument([sheet]);
    const layout = new LayoutEngine().compute(doc, "s1");
    const topicMap = collectAllTopics(sheet);
    const en = getEditorMessages("en").a11y;

    expect(buildSelectionAnnouncement([], topicMap, layout, en)).toBe("");
    expect(buildSelectionAnnouncement(["a"], topicMap, layout, en)).toContain("Alpha");
    expect(buildSelectionAnnouncement(["a", "b"], topicMap, layout, en)).toBe("2 topics selected");
  });
});
