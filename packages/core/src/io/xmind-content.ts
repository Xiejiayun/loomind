import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { strFromU8, strToU8 } from "fflate";
import { createRichText, richTextToPlainText, type InlineAsset, type MindmapTopic, type RichTextDoc, type RichTextMark } from "../model/document.js";
import { canonicalJson, RichTextDocSchema } from "../model/schema.js";

type TitleRun = { text: string; "fo:font-weight"?: string; "fo:font-style"?: string };
export type XMindImage = { src: string; width?: number; height?: number; isMathJaxImage?: boolean };
type TopicImage = NonNullable<MindmapTopic["image"]>;

export function titleRuns(title: RichTextDoc): TitleRun[] | undefined {
  if (!title.content.some((paragraph) => paragraph.content?.some((part) => part.marks?.length))) return;
  return title.content.flatMap((paragraph, index) => [
    ...(index > 0 ? [{ text: "\n" }] : []),
    ...(paragraph.content ?? []).map((part) => ({
      text: part.text,
      ...(part.marks?.some((mark) => mark.type === "bold") ? { "fo:font-weight": "700" } : {}),
      ...(part.marks?.some((mark) => mark.type === "italic") ? { "fo:font-style": "italic" } : {}),
    })),
  ]);
}

export function readTitle(text: string, runs: TitleRun[] | undefined, extended: unknown): RichTextDoc {
  const rich = RichTextDocSchema.safeParse(extended);
  if (rich.success && richTextToPlainText(rich.data) === text && canonicalJson(titleRuns(rich.data)) === canonicalJson(runs)) return rich.data;
  if (!Array.isArray(runs) || !runs.every((run) => typeof run?.text === "string") || runs.map((run) => run.text).join("") !== text) return createRichText(text);
  const title: RichTextDoc = { type: "doc", content: [{ type: "paragraph", content: [] }] };
  for (const run of runs) {
    const marks: RichTextMark[] = [];
    if (["bold", "700"].includes(String(run["fo:font-weight"]))) marks.push({ type: "bold" });
    if (run["fo:font-style"] === "italic") marks.push({ type: "italic" });
    run.text.split("\n").forEach((part, index) => {
      if (index) title.content.push({ type: "paragraph", content: [] });
      if (part) title.content.at(-1)!.content!.push({ type: "text", text: part, ...(marks.length ? { marks } : {}) });
    });
  }
  return title;
}

const extensions = { "image/png": "png", "image/jpeg": "jpg", "image/svg+xml": "svg", "image/webp": "webp" } as const;
const types = new Map<string, InlineAsset["mimeType"]>(Object.entries(extensions).map(([type, extension]) => [extension, type as InlineAsset["mimeType"]]));
types.set("jpeg", "image/jpeg");

export function imageWriter(assets: Record<string, InlineAsset>) {
  const resources: Record<string, Uint8Array> = {};
  const paths = new Map<string, string>();
  function write(image: TopicImage) {
    const asset = assets[image.resourceId];
    if (!asset) throw new Error(`Missing image: ${image.resourceId}`);
    let path = paths.get(image.resourceId);
    if (!path) {
      const bytes = strToU8(atob(asset.dataBase64), true);
      path = `resources/${bytesToHex(sha256(bytes))}.${extensions[asset.mimeType]}`;
      paths.set(image.resourceId, path);
      resources[path] = bytes;
    }
    return { native: { src: `xap:${path}`, width: image.width, height: image.height },
      meta: { src: `xap:${path}`, resourceId: image.resourceId, pos: image.pos, width: asset.width, height: asset.height } };
  }
  return { write, resources };
}

function positiveDimension(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

export function imageReader(entries: Record<string, Uint8Array>) {
  const assets: Record<string, InlineAsset> = Object.create(null);
  const payloads = new Map<string, Pick<InlineAsset, "sha256" | "dataBase64" | "mimeType">>();
  function read(image: XMindImage, extended: unknown): TopicImage {
    const match = /^xap:(resources\/[^?#]+\.(\w+))$/i.exec(image.src);
    const mimeType = match && types.get(match[2].toLowerCase());
    if (!match || !mimeType) throw new Error(`Unsupported XMind image: ${image.src}`);
    const path = match[1];
    let payload = payloads.get(path);
    if (!payload) {
      const bytes = entries[path];
      if (!bytes?.length) throw new Error(`Missing XMind image: ${path}`);
      payload = { mimeType, sha256: bytesToHex(sha256(bytes)), dataBase64: btoa(strFromU8(bytes, true)) };
      payloads.set(path, payload);
    }
    const meta = extended && typeof extended === "object" && "src" in extended && extended.src === image.src ? extended as Record<string, unknown> : {};
    const fallbackId = `img-${payload.sha256}`;
    let resourceId = typeof meta.resourceId === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(meta.resourceId) ? meta.resourceId : fallbackId;
    if (assets[resourceId] && assets[resourceId].sha256 !== payload.sha256) resourceId = fallbackId;
    const width = positiveDimension(image.width, positiveDimension(meta.width, 180));
    const height = positiveDimension(image.height, positiveDimension(meta.height, 120));
    assets[resourceId] ??= { ...payload, resourceId, width: positiveDimension(meta.width, width), height: positiveDimension(meta.height, height) };
    return { resourceId, width, height, pos: meta.pos === "left" || meta.pos === "right" ? meta.pos : "top" };
  }
  return { read, assets };
}
