import { describe, expect, it } from "vitest";
import {
  createDocument,
  createSheet,
  createTopic,
  LocalImmerSyncAdapter,
  MindmapDocumentSchema,
  richTextToPlainText,
  validateDocumentInvariants,
  type RichTextDoc,
} from "@mindmap/core";
import {
  buildReplaceCommandsForTopic,
  findAncestorTopicIds,
  findTopicsInSheet,
  replaceInRichText,
} from "../src/chrome/find-replace.js";

describe("find-and-replace engine", () => {
  it("finds matches across titles, subtitles, notes, labels, floating topics, and summaries", () => {
    const root = createTopic("root", "Alpha Plan", {
      children: [
        createTopic("t1", "Design", {
          subtitle: "alpha phase",
          labels: ["Alpha-Team"],
        }),
        createTopic("t2", "Implementation", {
          note: { format: "markdown", text: "Check ALPHA specs twice: alpha" },
        }),
      ],
    });
    const sheet = createSheet("s1", "Sheet", root, {
      floatingTopics: [createTopic("flt-1", "Alpha note")],
      summaries: [
        {
          id: "sum-1",
          parentId: "root",
          startIndex: 0,
          endIndex: 1,
          brace: "curly",
          topic: createTopic("sumt-1", "Alpha summary"),
        },
      ],
    });

    const insensitive = findTopicsInSheet(sheet, "alpha");
    expect(insensitive.map((m) => m.topicId)).toEqual(["root", "t1", "t2", "flt-1", "sumt-1"]);
    expect(insensitive[1]).toMatchObject({ subtitleMatches: 1, labelMatches: 1, totalMatches: 2 });
    expect(insensitive[2]).toMatchObject({ noteMatches: 2, totalMatches: 2 });

    const sensitive = findTopicsInSheet(sheet, "Alpha", { caseSensitive: true });
    expect(sensitive.map((m) => m.topicId)).toEqual(["root", "t1", "flt-1", "sumt-1"]);
  });

  it("replaces within RichTextDoc while preserving inline marks and cross-mark boundaries", () => {
    const rich: RichTextDoc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Hello " },
            { type: "text", text: "foo", marks: [{ type: "bold" }] },
            { type: "text", text: "bar", marks: [{ type: "italic" }] },
            { type: "text", text: " foo!", marks: [{ type: "highlight", attrs: { backgroundColor: "#FEF08AFF" } }] },
          ],
        },
      ],
    };

    const res = replaceInRichText(rich, "foobar", "QUX");
    expect(res.count).toBe(1);
    expect(richTextToPlainText(res.doc)).toBe("Hello QUX foo!");
    // Replaced span keeps the mark of the starting run ("bold")
    expect(res.doc.content[0].content?.[1]).toEqual({
      type: "text",
      text: "QUX",
      marks: [{ type: "bold" }],
    });
    // Remaining highlight mark stays intact
    expect(res.doc.content[0].content?.[2]?.marks).toEqual([
      { type: "highlight", attrs: { backgroundColor: "#FEF08AFF" } },
    ]);
  });

  it("builds undoable replace commands that keep the document schema-valid", () => {
    const root = createTopic("root", "V1 Roadmap", {
      children: [
        createTopic("c1", "V1 Launch", {
          subtitle: "V1 milestone",
          note: { format: "markdown", text: "Ship V1 soon" },
          labels: ["V1"],
        }),
      ],
    });
    const doc = createDocument([createSheet("s1", "Sheet", root)]);
    const adapter = new LocalImmerSyncAdapter(doc);

    const { commands, count } = buildReplaceCommandsForTopic("s1", doc.sheets[0].rootTopic.children[0], "V1", "V2");
    expect(count).toBe(4);
    for (const cmd of commands) {
      adapter.applyCommand(cmd);
    }

    const updated = adapter.getDocument();
    const c1 = updated.sheets[0].rootTopic.children[0];
    expect(richTextToPlainText(c1.title)).toBe("V2 Launch");
    expect(c1.subtitle).toBe("V2 milestone");
    expect(c1.note?.text).toBe("Ship V2 soon");
    expect(c1.labels).toEqual(["V2"]);
    expect(MindmapDocumentSchema.safeParse(updated).success).toBe(true);
    expect(validateDocumentInvariants(updated)).toEqual([]);
  });

  it("returns ancestor chain for auto-expanding collapsed branches", () => {
    const root = createTopic("root", "Root", {
      children: [
        createTopic("a", "A", {
          collapsed: true,
          children: [createTopic("b", "B", { children: [createTopic("c", "C")] })],
        }),
      ],
    });
    const sheet = createSheet("s1", "Sheet", root);
    expect(findAncestorTopicIds(sheet, "c")).toEqual(["root", "a", "b"]);
  });
});
