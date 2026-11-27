import { describe, expect, it } from "vitest";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import {
  createDocument,
  createSheet,
  createTopic,
  exportToXMind,
  importFromXMind,
  MindmapDocumentSchema,
  richTextToPlainText,
  validateDocumentInvariants,
} from "../src/index.js";

describe("T5 XMind import/export fidelity & validation gate", () => {
  it("reads third-party embedded images, attributed titles and source equations without Loomind extensions", () => {
    const bytes = strToU8('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>');
    const resource = "resources/drawing.svg";
    const content = [{ id: "sheet", title: "Workbook", rootTopic: { id: "root", title: "A B",
      attributedTitle: [{ text: "A", "fo:font-weight": "700" }, { text: " B", "fo:font-style": "italic" }],
      image: { src: `xap:${resource}` }, extensions: [{ provider: "org.xmind.ui.mathJax", content: { content: "x^2" } }] } }];
    const archive = { "content.json": strToU8(JSON.stringify(content)), [resource]: bytes };
    const doc = importFromXMind(zipSync(archive));
    const topic = doc.sheets[0].rootTopic;
    expect(topic.title.content[0].content).toEqual([{ type: "text", text: "A", marks: [{ type: "bold" }] }, { type: "text", text: " B", marks: [{ type: "italic" }] }]);
    expect(topic.equation?.latex).toBe("x^2");
    const asset = doc.assets[topic.image!.resourceId];
    expect(atob(asset.dataBase64)).toBe(strFromU8(bytes));
    const exported = unzipSync(exportToXMind(doc));
    const native = JSON.parse(strFromU8(exported["content.json"]));
    const exportedPath = native[0].rootTopic.image.src.slice(4);
    expect(exported[exportedPath]).toEqual(bytes);
    expect(JSON.parse(strFromU8(exported["manifest.json"]))["file-entries"]).toHaveProperty([exportedPath]);
    native[0].rootTopic.attributedTitle[0]["fo:font-weight"] = "400";
    exported["content.json"] = strToU8(JSON.stringify(native));
    const updated = importFromXMind(zipSync(exported)).sheets[0].rootTopic;
    expect(updated.title.content[0].content![0].marks).toBeUndefined();
    native[0].rootTopic.title = "Renamed in XMind";
    exported["content.json"] = strToU8(JSON.stringify(native));
    expect(richTextToPlainText(importFromXMind(zipSync(exported)).sheets[0].rootTopic.title)).toBe("Renamed in XMind");
    expect(() => importFromXMind(zipSync({ "content.json": archive["content.json"] }))).toThrow(/Missing XMind image/);
  });

  it("round-trips multi-sheet layouts, directions, spacings, tasks, nested branch summaries, notes, markers, floating topics, and relationships", () => {
    const nestedChild1 = createTopic("sub-1", "Sub 1", { task: { status: "done" }, markers: ["priority:1"] });
    const nestedChild2 = createTopic("sub-2", "Sub 2", { task: { status: "todo" }, note: { format: "markdown", text: "Sub note" } });
    const branch1 = createTopic("b1", "Branch 1", { children: [nestedChild1, nestedChild2] });
    const branch2 = createTopic("b2", "Branch 2", { labels: ["tag1", "tag2"] });
    const root1 = createTopic("root-1", "Sheet One Root", { children: [branch1, branch2] });
    const float1 = createTopic("float-1", "Floating Note", { floatingPos: { x: 320, y: 140 } });

    const sheet1 = createSheet("sheet-1", "Logic Sheet", root1, {
      structure: "logic",
      direction: "rightLeft",
      spacing: "spacious",
      floatingTopics: [float1],
      summaries: [
        {
          id: "sum-root",
          parentId: "root-1",
          startIndex: 0,
          endIndex: 1,
          brace: "curly",
          topic: createTopic("sum-root-topic", "Root Summary"),
        },
        {
          id: "sum-nested",
          parentId: "b1",
          startIndex: 0,
          endIndex: 1,
          brace: "bracket",
          topic: createTopic("sum-nested-topic", "Nested Branch Summary"),
        },
      ],
      relationships: [
        { id: "rel-1", fromId: "b2", toId: "float-1", title: "links to" },
      ],
    });

    const sheet2 = createSheet(
      "sheet-2",
      "Org Chart",
      createTopic("root-2", "CEO", { children: [createTopic("vp-1", "VP Eng")] }),
      { structure: "org", direction: "bottomUp", spacing: "compact" },
    );

    const original = createDocument([sheet1, sheet2]);
    expect(validateDocumentInvariants(original)).toEqual([]);

    const zipBytes = exportToXMind(original);
    const imported = importFromXMind(zipBytes);

    expect(MindmapDocumentSchema.safeParse(imported).success).toBe(true);
    expect(validateDocumentInvariants(imported)).toEqual([]);
    expect(imported.sheets).toHaveLength(2);

    const s1 = imported.sheets[0];
    expect(s1.structure).toBe("logic");
    expect(s1.direction).toBe("rightLeft");
    expect(s1.spacing).toBe("spacious");
    expect(s1.rootTopic.children[0].children[0].task).toEqual({ status: "done" });
    expect(s1.rootTopic.children[0].children[1].task).toEqual({ status: "todo" });
    expect(s1.rootTopic.children[0].children[0].markers).toEqual(["priority:1"]);
    expect(s1.rootTopic.children[0].children[1].note?.text).toBe("Sub note");
    expect(s1.floatingTopics).toHaveLength(1);
    expect(s1.floatingTopics[0].floatingPos).toEqual({ x: 320, y: 140 });
    expect(s1.relationships).toHaveLength(1);
    expect(s1.relationships[0]).toMatchObject({ fromId: "b2", toId: "float-1", title: "links to" });

    // Both root and nested branch summaries preserve their ACTUAL parentId & covered range
    const rootSum = s1.summaries.find((s) => s.id === "sum-root");
    const nestedSum = s1.summaries.find((s) => s.id === "sum-nested");
    expect(rootSum).toMatchObject({ parentId: "root-1", startIndex: 0, endIndex: 1, brace: "curly" });
    expect(nestedSum).toMatchObject({ parentId: "b1", startIndex: 0, endIndex: 1, brace: "bracket" });
    expect(richTextToPlainText(nestedSum!.topic.title)).toBe("Nested Branch Summary");

    const s2 = imported.sheets[1];
    expect(s2.structure).toBe("org");
    expect(s2.direction).toBe("bottomUp");
    expect(s2.spacing).toBe("compact");
  });

  it("imports external XMind structureClass, native task markers, and sanitizes invalid IDs & overly long labels", () => {
    const externalContent = [
      {
        id: "!!!bad sheet id!!!",
        title: "External Fishbone",
        rootTopic: {
          id: "root id with spaces",
          title: "Problem",
          structureClass: "org.xmind.ui.fishbone.leftHeaded",
          children: {
            attached: [
              {
                id: "cause-1",
                title: "Cause 1",
                markers: [{ markerId: "task-done" }],
                labels: ["a".repeat(40), "b", "c", "d", "e", "f", "g"],
              },
              {
                id: "cause-2",
                title: "Cause 2",
                markers: [{ markerId: "task-start" }],
              },
            ],
            summary: [{ id: "sum-topic-ext", title: "Key Causes" }],
          },
          summaries: [
            { id: "sum-ext", range: "(0,1)", topicId: "sum-topic-ext" },
            { id: "sum-oob", range: "(0,99)", topicId: "missing" },
          ],
        },
        relationships: [
          { id: "rel-ok", end1Id: "cause-1", end2Id: "cause-2", title: "affects" },
          { id: "rel-dangling", end1Id: "cause-1", end2Id: "non-existent" },
        ],
      },
    ];

    const zipBytes = zipSync({ "content.json": strToU8(JSON.stringify(externalContent)) });
    const imported = importFromXMind(zipBytes);

    expect(MindmapDocumentSchema.safeParse(imported).success).toBe(true);
    expect(validateDocumentInvariants(imported)).toEqual([]);
    expect(imported.sheets[0].structure).toBe("fishbone");
    expect(imported.sheets[0].rootTopic.children[0].task).toEqual({ status: "done" });
    expect(imported.sheets[0].rootTopic.children[1].task).toEqual({ status: "todo" });
    expect(imported.sheets[0].rootTopic.children[0].labels).toHaveLength(6);
    expect(imported.sheets[0].rootTopic.children[0].labels![0]).toHaveLength(24);
    expect(imported.sheets[0].summaries).toHaveLength(1);
    expect(imported.sheets[0].relationships).toHaveLength(1);
  });

  it("rejects malformed or empty .xmind archives explicitly", () => {
    expect(() => importFromXMind(new Uint8Array([1, 2, 3]))).toThrow(/failed to unzip/i);
    expect(() => importFromXMind(zipSync({ "other.txt": strToU8("hi") }))).toThrow(/missing content\.json/i);
    expect(() => importFromXMind(zipSync({ "content.json": strToU8("[]") }))).toThrow(/at least one sheet/i);
    expect(() => importFromXMind(zipSync({ "content.json": strToU8("[{}]") }))).toThrow(/missing rootTopic/i);
  });
});
