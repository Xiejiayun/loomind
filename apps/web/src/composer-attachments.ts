import { createTopic, generateId, type InlineAsset, type Locale, type MindmapDocument, type MindmapTopic } from "@mindmap/core";
import { getWebMessages } from "./i18n.js";
import { contentFromSource, SOURCE_TEXT_LIMIT, sourcePassages, type PassageSource } from "./source-material.js";

export const MAX_ATTACHMENTS = 4;
const fileTypes: Record<string, string> = { pdf: "application/pdf", txt: "text/plain", md: "text/markdown", markdown: "text/markdown", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp" };
export const ATTACHMENT_ACCEPT = [...Object.keys(fileTypes).map((suffix) => `.${suffix}`), ...new Set(Object.values(fileTypes))].join(",");

export interface SourceAttachment extends PassageSource {
  kind: "source"; title: string; summary?: string;
}
interface ImageAttachment {
  kind: "image"; name: string; title: string; image: NonNullable<MindmapTopic["image"]>; asset: InlineAsset;
}
export type ComposerAttachment = SourceAttachment | ImageAttachment;

export async function readAttachment(file: File, locale: Locale): Promise<ComposerAttachment> {
  const { attachments, source } = getWebMessages(locale);
  const extension = /\.([^.]+)$/.exec(file.name)?.[1].toLowerCase() ?? "";
  const mime = !file.type || file.type === "application/octet-stream" ? fileTypes[extension] : file.type;
  const name = file.name;
  const title = (name.replace(/\.[^.]+$/, "").trim() || name).slice(0, 120);
  if (mime === "application/pdf") {
    const { readPdfSource } = await import("./pdf-source.js");
    const pdf = await readPdfSource(file, locale);
    return { kind: "source", origin: "pdf", name, title, address: "", passages: pdf.passages, summary: source.pdfSummary(pdf.pages, pdf.emptyPages) };
  }
  if (mime === "text/plain" || mime === "text/markdown" || (mime === "text/x-markdown" && fileTypes[extension] === "text/markdown")) {
    if (file.size > SOURCE_TEXT_LIMIT * 4 + 3) throw new Error(source.tooLong);
    const bytes = await file.arrayBuffer();
    let text: string;
    try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
    catch { throw new Error(attachments.textInvalid); }
    if (text.includes("\0")) throw new Error(attachments.textInvalid);
    const passages = sourcePassages(text, locale);
    if (!passages.length) throw new Error(source.empty);
    return { kind: "source", origin: "text", name, title, address: "", passages };
  }
  if (mime !== "image/png" && mime !== "image/jpeg" && mime !== "image/webp") throw new Error(attachments.unsupported);
  if (file.size > 16 * 1024 * 1024) throw new Error(attachments.imageSize);
  const { processImageFileForTopic } = await import("@mindmap/editor/image-utils");
  const result = await processImageFileForTopic(file, mime);
  if (!result.ok) throw new Error(result.error === "IMAGE_TOO_LARGE" ? attachments.imageSize : attachments.unreadable);
  const resourceId = generateId("img");
  return { kind: "image", name, title, image: { resourceId, width: result.displayWidth, height: result.displayHeight, pos: "top" },
    asset: { resourceId, mimeType: result.mimeType, width: result.assetWidth, height: result.assetHeight, dataBase64: result.dataBase64, sha256: result.sha256 } };
}

export function withAttachments(document: MindmapDocument, attachments: ComposerAttachment[], locale: Locale): MindmapDocument {
  const assets = { ...document.assets };
  const sheets = document.sheets.map((sheet) => {
    if (sheet.id !== document.activeSheetId) return sheet;
    const root = { ...sheet.rootTopic, children: [...sheet.rootTopic.children] };
    for (const item of attachments) {
      if (item.kind === "image") {
        assets[item.asset.resourceId] = item.asset;
        root.children.push(createTopic(generateId("topic"), item.name, { image: item.image }));
      } else {
        const content = contentFromSource(item, locale);
        if (attachments.length === 1) {
          root.children.push(...content.children);
          if (content.href) root.href = content.href;
        } else root.children.push(createTopic(generateId("topic"), item.origin === "web" ? item.title : item.name, content));
      }
    }
    return { ...sheet, rootTopic: root };
  });
  return { ...document, sheets, assets };
}
