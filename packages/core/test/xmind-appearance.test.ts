import { describe, expect, it } from "vitest";
import { strToU8, zipSync } from "fflate";
import { computeSheetLayout, createDocument, exportToXMind, getThemePalette, importFromXMind, LayoutEngine, serializeToSvg } from "../src/index.js";
import { LoroSyncAdapter } from "../src/store/loro-adapter.js";
import { nativeSheet } from "./fixtures/xmind-appearance.js";

const workbook = (...sheets: unknown[]) => zipSync({ "content.json": strToU8(JSON.stringify(sheets)) });

describe("native Xmind appearance and clockwise maps", () => {
  it("keeps independent sheet themes, editable topics and clockwise reading order on a dark workspace", () => {
    const doc = importFromXMind(workbook(nativeSheet("print", false), nativeSheet("sketch", true)));
    expect(doc.theme).toEqual(createDocument().theme);
    for (const [index, sheet] of doc.sheets.entries()) {
      const { id, rootTopic } = sheet;
      const layout = new LayoutEngine().compute(doc, id, { appearance: "dark" });
      const root = layout.nodes.get(rootTopic.id)!;
      const main = layout.nodes.get(`${id}-0`)!;
      const edge = layout.edges.find((item) => item.toId === main.id)!;
      expect(sheet.theme?.canvasColor).toBe("#FFFFFFFF");
      expect(root.fillColor).toBe("#00000000");
      expect(root.fontFamily).toContain(index ? "cursive" : "serif");
      expect(root.strokeWidth).toBe(index ? 5 : 0);
      expect(main).toMatchObject({ shape: index ? "rounded" : "underline", fillColor: index ? "#F9423AFF" : "#00000000" });
      expect(edge).toMatchObject({ kind: index ? "tapered" : "fold", color: "#F9423AFF", handdrawn: !!index });
      const displayed = (side: "left" | "right") => rootTopic.children.map((child) => layout.nodes.get(child.id)!)
        .filter((node) => node.side === side).sort((a, b) => a.box.y - b.box.y).map((node) => node.id);
      const ids = rootTopic.children.map((topic) => topic.id);
      const rightCount = index ? 4 : 3;
      expect(displayed("right")).toEqual(ids.slice(0, rightCount));
      expect(displayed("left")).toEqual(ids.slice(rightCount).reverse());
      expect(serializeToSvg(doc, { sheetId: id })).toContain("rgb(255, 255, 255)");
    }
    expect(importFromXMind(exportToXMind(doc)).sheets).toEqual(doc.sheets);
  });

  it("honors a stored right count without changing source indices, and keeps topic overrides above role defaults", () => {
    const sheet = nativeSheet("manual", true);
    const root = sheet.rootTopic;
    const overrides = { "fo:color": "#ABCDEF", "fo:font-size": "16px", "svg:fill": "#123456", "fill-pattern": "solid" };
    Object.assign(root.children.attached[0], { style: { properties: overrides } });
    Object.assign(root, { structureClass: "org.xmind.ui.map.unbalanced", extensions: [{ provider: "org.xmind.ui.map.unbalanced", content: [{ name: "right-number", content: "1" }] }],
      boundaries: [{ id: "span", range: "(0,2)" }] });
    const doc = importFromXMind(workbook(sheet));
    const layout = computeSheetLayout(doc);
    expect(layout.nodes.get("manual-0")).toMatchObject({ side: "right", fillColor: "#123456FF", fontSize: 16, textColor: "#ABCDEFFF" });
    expect(layout.nodes.get("manual-1")!.side).toBe("left");
    expect(layout.nodes.get("manual-8")!.box.y).toBeLessThan(layout.nodes.get("manual-1")!.box.y);
    expect(doc.sheets[0].rootTopic.children.map((topic) => topic.id)).toEqual(root.children.attached.map((topic) => topic.id));
    expect(doc.sheets[0].boundaries[0].target).toMatchObject({ startIndex: 0, endIndex: 2 });
    expect(importFromXMind(exportToXMind(doc)).sheets).toEqual(doc.sheets);
  });

  it("keeps the native layout across collaboration snapshots and allows a built-in theme to replace one sheet's styling", () => {
    const doc = importFromXMind(workbook(nativeSheet("day", false), nativeSheet("sketch", true)));
    const adapter = LoroSyncAdapter.fromSnapshot(new LoroSyncAdapter(doc).exportSnapshot());
    expect(adapter.getDocument().sheets[0]).toMatchObject({ branchOrder: "clockwise", theme: doc.sheets[0].theme });
    adapter.applyCommand({ type: "theme/set", sheetId: "day", patch: { paletteId: "blueprint", skeletonId: "classic-cards" } });
    const changed = adapter.getDocument();
    expect(getThemePalette({ ...changed.theme, ...changed.sheets[0].theme }).isDark).toBe(true);
    expect(computeSheetLayout(changed).nodes.get("day-0")!.underlineMode).toBe(false);
    expect(changed.sheets[1].theme).toEqual(doc.sheets[1].theme);
    expect(changed.theme).toEqual(doc.theme);
  });

  it("prefers sheet-local canvas color and drops unsupported style values without rejecting the workbook", () => {
    const sheet = nativeSheet("custom", false);
    Object.assign(sheet, { style: { properties: { "svg:fill": "#182032" } } });
    Object.assign(sheet.theme.mainTopic.properties, { "fo:font-family": "unsupported(font)", "fo:font-size": "auto", "line-width": "unknown" });
    const doc = importFromXMind(workbook(sheet));
    const theme = doc.sheets[0].theme!;
    expect(theme.topicStyles!.mainTopic!.fontFamily).toBeUndefined();
    expect(theme.topicStyles!.mainTopic!.fontSize).toBeUndefined();
    expect(getThemePalette({ ...doc.theme, ...theme }, "light")).toMatchObject({ isDark: true, canvasBg: "#182032FF" });
  });
});
