import type { Locale } from "@mindmap/core";
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { getWebMessages } from "./i18n.js";
import { SOURCE_PASSAGE_LIMIT, SOURCE_TEXT_LIMIT, sourcePassages, type CitedPassage } from "./source-material.js";

GlobalWorkerOptions.workerSrc = workerUrl;

export interface PdfSource { filename: string; pages: number; emptyPages: number[]; passages: CitedPassage[] }

export async function readPdfSource(file: File, locale: Locale): Promise<PdfSource> {
  const messages = getWebMessages(locale).source;
  if (file.size > 16 * 1024 * 1024) throw new Error(messages.pdfSize);
  const task = getDocument({ data: new Uint8Array(await file.arrayBuffer()), useSystemFonts: false, disableFontFace: true,
    cMapUrl: new URL(`${import.meta.env.BASE_URL}pdf-cmaps/`, location.origin).href, cMapPacked: true, useWorkerFetch: true, useWasm: false });
  try {
    const pdf = await task.promise;
    if (pdf.numPages > 100) throw new Error(messages.pdfPages);
    const passages: CitedPassage[] = [];
    const emptyPages: number[] = [];
    let length = 0;
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent({ disableNormalization: true });
      const fragments: string[] = [];
      for (const item of content.items) {
        if (!("str" in item)) continue;
        length += item.str.length + Number(item.hasEOL);
        if (length > SOURCE_TEXT_LIMIT) throw new Error(messages.tooLong);
        fragments.push(item.str);
        if (item.hasEOL) fragments.push("\n");
      }
      const extracted = sourcePassages(fragments.join(""), locale);
      if (!extracted.length) emptyPages.push(pageNumber);
      for (const passage of extracted) passages.push({ ...passage, page: pageNumber });
      if (passages.length > SOURCE_PASSAGE_LIMIT) throw new Error(messages.tooMany);
      page.cleanup();
    }
    if (!passages.length) throw new Error(messages.pdfEmpty);
    return { filename: file.name, pages: pdf.numPages, emptyPages, passages };
  } catch (reason) {
    if (reason instanceof Error && reason.name === "PasswordException") throw new Error(messages.pdfPassword);
    if (reason instanceof Error && reason.name === "InvalidPDFException") throw new Error(messages.pdfInvalid);
    throw reason;
  } finally { await task.destroy(); }
}
