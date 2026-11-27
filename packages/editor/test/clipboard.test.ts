import { describe, expect, it } from "vitest";
import {
  createRichText,
  createSheet,
  createTopic,
  richTextToPlainText,
  type InlineAsset,
} from "@mindmap/core";
import {
  buildTakenTopicIds,
  deserializeClipboardPayload,
  parsePastedTextToTopics,
  serializeTopicsForClipboard,
} from "../src/canvas/clipboard.js";

describe("topic clipboard serialization & deserialization", () => {
  it("serializes subtrees with assets, deduplicates selected descendants, and regenerates fresh IDs on paste", () => {
    const asset: InlineAsset = {
      resourceId: "img-a",
      mimeType: "image/png",
      width: 100,
      height: 80,
      sha256: "hash-a",
      dataBase64: "iVBORw0KGgo=",
    };
    const root = createTopic("root", "Root", {
      children: [
        createTopic("b1", "Branch 1", {
          markers: ["priority:1"],
          note: { format: "markdown", text: "Important detail" },
          callout: { id: "co-1", title: createRichText("Note!") },
          image: { resourceId: "img-a", width: 100, height: 80, pos: "top" },
          manualOffset: { dx: 20, dy: -10 },
          children: [createTopic("b1-1", "Child 1.1", { task: { status: "done" } })],
        }),
        createTopic("b2", "Branch 2"),
      ],
    });
    const sheet = createSheet("s1", "Sheet", root);

    // Selecting both b1 and its child b1-1 should serialize b1 once (not duplicate b1-1)
    const bundle = serializeTopicsForClipboard(sheet, ["b1", "b1-1"], { "img-a": asset });
    expect(bundle).not.toBeNull();
    expect(bundle!.text).toContain("Branch 1");
    expect(bundle!.text).toContain("[x] Child 1.1");
    expect(bundle!.text).toContain("> Important detail");

    const deletedIds = new Set<string>(["t-old"]);
    const takenIds = buildTakenTopicIds(sheet);
    const deserialized = deserializeClipboardPayload({
      customJson: bundle!.json,
      plainText: bundle!.text,
      deletedIds,
      takenIds,
    });

    expect(deserialized).not.toBeNull();
    expect(deserialized!.topics).toHaveLength(1);
    const pasted = deserialized!.topics[0];
    expect(pasted.id).not.toBe("b1");
    expect(pasted.manualOffset).toBeUndefined();
    expect(pasted.markers).toEqual(["priority:1"]);
    expect(pasted.note?.text).toBe("Important detail");
    expect(pasted.callout?.id).not.toBe("co-1");
    expect(pasted.children).toHaveLength(1);
    expect(pasted.children[0].id).not.toBe("b1-1");
    expect(pasted.children[0].task).toEqual({ status: "done" });
    expect(deserialized!.assets["img-a"]).toEqual(asset);
  });

  it("uses internal fallback when system clipboard strips custom MIME but keeps plain text", () => {
    const root = createTopic("root", "Root", {
      children: [createTopic("b1", "Styled", { style: { fillColor: "#EFF6FFFF" } })],
    });
    const sheet = createSheet("s1", "Sheet", root);
    const bundle = serializeTopicsForClipboard(sheet, ["b1"], {})!;

    const res = deserializeClipboardPayload({
      customJson: "",
      plainText: bundle.text,
      internalFallback: bundle,
      deletedIds: new Set(),
      takenIds: buildTakenTopicIds(sheet),
    });

    expect(res?.topics[0].style?.fillColor).toBe("#EFF6FFFF");
  });

  it("parses multi-line Markdown headings, nested bullets, tasks, and notes into a topic tree", () => {
    const md = [
      "# Launch Plan",
      "## Engineering",
      "  - [x] Build API",
      "    > Uses Cloudflare D1",
      "  - [ ] Write E2E tests",
      "## Marketing",
      "  - Blog post",
      "    - Draft outline",
    ].join("\n");

    const topics = parsePastedTextToTopics(md, new Set(), new Set());
    expect(topics).toHaveLength(1);
    expect(richTextToPlainText(topics[0].title)).toBe("Launch Plan");
    expect(topics[0].children).toHaveLength(2);

    const eng = topics[0].children[0];
    expect(richTextToPlainText(eng.title)).toBe("Engineering");
    expect(eng.children).toHaveLength(2);
    expect(richTextToPlainText(eng.children[0].title)).toBe("Build API");
    expect(eng.children[0].task).toEqual({ status: "done" });
    expect(eng.children[0].note?.text).toBe("Uses Cloudflare D1");
    expect(eng.children[1].task).toEqual({ status: "todo" });

    const mkt = topics[0].children[1];
    expect(richTextToPlainText(mkt.children[0].children[0].title)).toBe("Draft outline");
  });

  it("parses indented plain text lines into nested topics", () => {
    const text = "Phase 1\n  Research\n  Prototype\nPhase 2\n  Launch";
    const topics = parsePastedTextToTopics(text, new Set(), new Set());
    expect(topics).toHaveLength(2);
    expect(topics[0].children.map((c) => richTextToPlainText(c.title))).toEqual(["Research", "Prototype"]);
    expect(topics[1].children.map((c) => richTextToPlainText(c.title))).toEqual(["Launch"]);
  });
});
