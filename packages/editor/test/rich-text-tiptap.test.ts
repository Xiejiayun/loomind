import { describe, expect, it } from "vitest";
import { getSchema } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import TextStyle from "@tiptap/extension-text-style";
import Color from "@tiptap/extension-color";
import Highlight from "@tiptap/extension-highlight";
import Link from "@tiptap/extension-link";
import {
  createDocument,
  LocalImmerSyncAdapter,
  MindmapDocumentSchema,
  RichTextDocSchema,
  richTextToPlainText,
  validateDocumentInvariants,
  type RichTextDoc,
} from "@mindmap/core";
import { LoroSyncAdapter } from "../../core/src/store/loro-adapter.js";
import {
  DEFAULT_HIGHLIGHT_HEX8,
  normalizeTipTapJson,
  parseCssColorToHex8,
  richTextDocToTipTapJson,
} from "../src/canvas/rich-text-tiptap.js";

function createTopicEditorSchema() {
  return getSchema([
    StarterKit.configure({
      heading: false,
      bulletList: false,
      orderedList: false,
      blockquote: false,
      codeBlock: false,
      horizontalRule: false,
    }),
    TextStyle,
    Color,
    Highlight.configure({ multicolor: true }),
    Link.configure({ openOnClick: false }),
  ]);
}

function assertValidAcrossAdapters(title: RichTextDoc) {
  expect(RichTextDocSchema.safeParse(title).success).toBe(true);

  const base = createDocument();
  const sheetId = base.sheets[0].id;
  const rootId = base.sheets[0].rootTopic.id;

  const localAdapter = new LocalImmerSyncAdapter(base);
  localAdapter.applyCommand({ type: "topic/setTitle", sheetId, topicId: rootId, title });
  const localDoc = localAdapter.getDocument();
  expect(MindmapDocumentSchema.safeParse(localDoc).success).toBe(true);
  expect(validateDocumentInvariants(localDoc)).toEqual([]);

  const loroAdapter = new LoroSyncAdapter(base);
  loroAdapter.applyCommand({ type: "topic/setTitle", sheetId, topicId: rootId, title });
  const loroDoc = loroAdapter.getDocument();
  expect(MindmapDocumentSchema.safeParse(loroDoc).success).toBe(true);
  expect(validateDocumentInvariants(loroDoc)).toEqual([]);
}

describe("parseCssColorToHex8", () => {
  it("normalizes hex and rgb/rgba strings to canonical 8-digit uppercase hex", () => {
    expect(parseCssColorToHex8("#fef08a")).toBe("#FEF08AFF");
    expect(parseCssColorToHex8("#FEF08A80")).toBe("#FEF08A80");
    expect(parseCssColorToHex8("#abc")).toBe("#AABBCCFF");
    expect(parseCssColorToHex8("#abcd")).toBe("#AABBCCDD");
    expect(parseCssColorToHex8("rgb(254, 240, 138)")).toBe("#FEF08AFF");
    expect(parseCssColorToHex8("rgba(255, 0, 128, 0.5)")).toBe("#FF008080");
    expect(parseCssColorToHex8("rgb(255 0 128 / 50%)")).toBe("#FF008080");
    expect(parseCssColorToHex8(null)).toBeNull();
    expect(parseCssColorToHex8("")).toBeNull();
    expect(parseCssColorToHex8("not-a-color")).toBeNull();
  });
});

describe("TipTap rich text round-trip (real TipTap schema)", () => {
  it("normalizes highlight color from TipTap and preserves it across re-entering edit mode", () => {
    const schema = createTopicEditorSchema();
    const fromButton = schema
      .nodeFromJSON({
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                text: "Highlighted",
                marks: [{ type: "highlight", attrs: { color: "#FEF08A" } }],
              },
              {
                type: "text",
                text: " custom",
                marks: [{ type: "highlight", attrs: { color: "#a7f3d0" } }],
              },
            ],
          },
        ],
      })
      .toJSON();

    const canonical = normalizeTipTapJson(fromButton);
    expect(canonical).toEqual({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "Highlighted",
              marks: [{ type: "highlight", attrs: { backgroundColor: DEFAULT_HIGHLIGHT_HEX8 } }],
            },
            {
              type: "text",
              text: " custom",
              marks: [{ type: "highlight", attrs: { backgroundColor: "#A7F3D0FF" } }],
            },
          ],
        },
      ],
    });
    assertValidAcrossAdapters(canonical);

    // Re-enter TopicEditor with canonical RichTextDoc and round-trip through real TipTap schema
    const reopened = schema.nodeFromJSON(richTextDocToTipTapJson(canonical)).toJSON();
    const recommitted = normalizeTipTapJson(reopened);
    expect(recommitted).toEqual(canonical);
    assertValidAcrossAdapters(recommitted);
  });

  it("converts hardBreak nodes into separate paragraphs without losing text", () => {
    const schema = createTopicEditorSchema();
    const withBreaks = schema
      .nodeFromJSON({
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: "Line 1" },
              { type: "hardBreak" },
              { type: "text", text: "Line 2", marks: [{ type: "bold" }] },
              { type: "hardBreak" },
              { type: "hardBreak" },
              { type: "text", text: "Line 4" },
            ],
          },
        ],
      })
      .toJSON();

    const canonical = normalizeTipTapJson(withBreaks);
    expect(richTextToPlainText(canonical)).toBe("Line 1\nLine 2\n\nLine 4");
    expect(canonical.content).toHaveLength(4);
    expect(canonical.content[1].content?.[0].marks).toEqual([{ type: "bold" }]);
    assertValidAcrossAdapters(canonical);
  });

  it("sanitizes pasted rgb/null/unknown marks while retaining valid content", () => {
    const pastedJson = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "RGB text",
              marks: [
                { type: "textStyle", attrs: { color: "rgb(37, 99, 235)" } },
                { type: "highlight", attrs: { color: "rgba(254, 240, 138, 1)" } },
                { type: "underline" },
              ],
            },
            {
              type: "text",
              text: " null attrs",
              marks: [
                { type: "textStyle", attrs: { color: null } },
                { type: "highlight", attrs: { color: null } },
              ],
            },
            {
              type: "text",
              text: " link",
              marks: [
                {
                  type: "link",
                  attrs: { href: "https://example.com", target: "_blank", rel: "noopener", class: null },
                },
              ],
            },
            {
              type: "text",
              text: " invalid color",
              marks: [{ type: "textStyle", attrs: { color: "var(--bad)" } }],
            },
          ],
        },
      ],
    };

    const canonical = normalizeTipTapJson(pastedJson);
    expect(canonical).toEqual({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "RGB text",
              marks: [
                { type: "textStyle", attrs: { color: "#2563EBFF" } },
                { type: "highlight", attrs: { backgroundColor: "#FEF08AFF" } },
              ],
            },
            {
              type: "text",
              text: " null attrs",
              marks: [{ type: "highlight" }],
            },
            {
              type: "text",
              text: " link",
              marks: [{ type: "link", attrs: { href: "https://example.com" } }],
            },
            {
              type: "text",
              text: " invalid color",
            },
          ],
        },
      ],
    });
    assertValidAcrossAdapters(canonical);
  });
});
