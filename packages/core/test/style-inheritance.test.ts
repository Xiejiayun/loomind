import { afterEach, describe, expect, it } from "vitest";
import {
  createDocument,
  createSheet,
  createTopic,
  LocalImmerSyncAdapter,
  MindmapDocumentSchema,
  richTextToPlainText,
  setLocale,
  validateDocumentInvariants,
} from "../src/index.js";

afterEach(() => {
  setLocale("zh");
});

describe("topic style inheritance on Tab (addChild) and Enter (addSibling)", () => {
  it("inherits sibling hexagon shape and blue fill when pressing Tab on parent", () => {
    const hexStyle = { fillColor: "#3B82F6FF", textColor: "#FFFFFFFF" };
    const root = createTopic("root", "Root", {
      children: [
        createTopic("b1", "Orange Branch", {
          shape: "pill",
          style: { fillColor: "#F59E0BFF" },
          children: [
            createTopic("c1", "Item 1", { shape: "hexagon", style: { ...hexStyle } }),
            createTopic("c2", "Item 2", { shape: "hexagon", style: { ...hexStyle } }),
            createTopic("c3", "Item 3", { shape: "hexagon", style: { ...hexStyle } }),
          ],
        }),
        createTopic("b2", "Empty Branch", {
          shape: "pill",
          style: { fillColor: "#F59E0BFF" },
        }),
      ],
    });
    const doc = createDocument([createSheet("s1", "Sheet", root)]);
    const adapter = new LocalImmerSyncAdapter(doc);

    // Tab on b1 (has 3 blue hexagon children) -> new child inherits blue hexagon!
    adapter.applyCommand({ type: "topic/addChild", sheetId: "s1", parentId: "b1", newId: "c4" });
    const c4 = adapter.getDocument().sheets[0].rootTopic.children[0].children[3];
    expect(c4.shape).toBe("hexagon");
    expect(c4.style).toEqual(hexStyle);

    // Tab on b2 (0 children, but depth-2 peers across sheet are all blue hexagons) -> inherits blue hexagon!
    adapter.applyCommand({ type: "topic/addChild", sheetId: "s1", parentId: "b2", newId: "b2-c1" });
    const b2c1 = adapter.getDocument().sheets[0].rootTopic.children[1].children[0];
    expect(b2c1.shape).toBe("hexagon");
    expect(b2c1.style).toEqual(hexStyle);

    // Enter on c1 (addSibling) -> inherits blue hexagon!
    adapter.applyCommand({
      type: "topic/addSibling",
      sheetId: "s1",
      targetId: "c1",
      position: "after",
      newId: "c1-sib",
    });
    const sib = adapter.getDocument().sheets[0].rootTopic.children[0].children[1];
    expect(sib.id).toBe("c1-sib");
    expect(sib.shape).toBe("hexagon");
    expect(sib.style).toEqual(hexStyle);

    const finalDoc = adapter.getDocument();
    expect(MindmapDocumentSchema.safeParse(finalDoc).success).toBe(true);
    expect(validateDocumentInvariants(finalDoc)).toEqual([]);
  });

  it("does not inherit a single one-off highlighted sibling when majority of siblings are unstyled", () => {
    const root = createTopic("root", "Root", {
      children: [
        createTopic("b1", "Branch", {
          children: [
            createTopic("c1", "Normal 1"),
            createTopic("c2", "Normal 2"),
            createTopic("c3", "Normal 3"),
            createTopic("c4", "One-off warning", { style: { fillColor: "#EF4444FF" } }),
          ],
        }),
      ],
    });
    const doc = createDocument([createSheet("s1", "Sheet", root)]);
    const adapter = new LocalImmerSyncAdapter(doc);

    adapter.applyCommand({ type: "topic/addChild", sheetId: "s1", parentId: "b1", newId: "c5" });
    const c5 = adapter.getDocument().sheets[0].rootTopic.children[0].children[4];
    expect(c5.shape).toBeUndefined();
    expect(c5.style).toBeUndefined();
  });

  it("inherits uniform All-Nodes style when creating a brand-new depth level", () => {
    const allStyle = { fillColor: "#EFF6FFFF", textColor: "#0F172AFF" };
    const root = createTopic("root", "Root", {
      shape: "rounded",
      style: { ...allStyle },
      children: [
        createTopic("b1", "Branch", {
          shape: "rounded",
          style: { ...allStyle },
        }),
      ],
    });
    const doc = createDocument([createSheet("s1", "Sheet", root)]);
    const adapter = new LocalImmerSyncAdapter(doc);

    adapter.applyCommand({ type: "topic/addChild", sheetId: "s1", parentId: "b1", newId: "d2" });
    const d2 = adapter.getDocument().sheets[0].rootTopic.children[0].children[0];
    expect(d2.shape).toBe("rounded");
    expect(d2.style).toEqual(allStyle);
  });

  it("uses locale-aware default topic titles in English and Chinese", () => {
    const doc = createDocument([createSheet("s1", "Sheet", createTopic("root", "Root"))]);
    const adapter = new LocalImmerSyncAdapter(doc);

    setLocale("en");
    adapter.applyCommand({ type: "topic/addChild", sheetId: "s1", parentId: "root", newId: "en-child" });
    expect(richTextToPlainText(adapter.getDocument().sheets[0].rootTopic.children[0].title)).toBe("Subtopic");

    setLocale("zh");
    adapter.applyCommand({ type: "topic/addChild", sheetId: "s1", parentId: "root", newId: "zh-child" });
    expect(richTextToPlainText(adapter.getDocument().sheets[0].rootTopic.children[1].title)).toBe("子主题");
  });
});
