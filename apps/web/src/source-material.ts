import { createDocument, createSheet, createTopic, generateId, type Locale } from "@mindmap/core";
import { getWebMessages } from "./i18n.js";
import { SOURCE_PASSAGE_LIMIT, SOURCE_TEXT_LIMIT } from "./webpage-contract.js";

export { SOURCE_PASSAGE_LIMIT, SOURCE_TEXT_LIMIT } from "./webpage-contract.js";
const marker = /^\s*(?:#{1,6}\s+|[-*+•]\s+|\d+[.)]\s+|\d+、\s*)/u;

export interface SourcePassage { title: string; quote: string; firstLine: number; lastLine: number }
export type CitedPassage = SourcePassage & { page?: number; paragraph?: number };
export interface PassageSource { origin: "text" | "pdf" | "web"; name: string; address: string; passages: CitedPassage[] }

export function passageLocation(passage: CitedPassage, locale: Locale) {
  const messages = getWebMessages(locale).source;
  if (passage.paragraph) return messages.paragraph(passage.paragraph);
  return passage.page ? messages.page(passage.page) : messages.lines(passage.firstLine, passage.lastLine);
}

function passageTitle(text: string) {
  const characters = Array.from(text);
  return characters.length > 72 ? `${characters.slice(0, 71).join("")}…` : text;
}

export function webpagePassages(paragraphs: string[]): CitedPassage[] {
  return paragraphs.map((quote, index) => ({ title: passageTitle(quote), quote, paragraph: index + 1, firstLine: 1, lastLine: 1 }));
}

export function sourcePassages(text: string, locale: Locale): SourcePassage[] {
  const messages = getWebMessages(locale).source;
  if (text.length > SOURCE_TEXT_LIMIT) throw new Error(messages.tooLong);
  const passages: SourcePassage[] = [];
  let lines: string[] = [];
  let firstLine = 0;
  function flush() {
    if (!lines.length) return;
    const quote = lines.join("\n");
    const first = lines[0].trim().replace(marker, "").trim() || lines[0].trim();
    passages.push({ title: passageTitle(first), quote, firstLine, lastLine: firstLine + lines.length - 1 });
    lines = [];
  }
  text.split(/\r\n?|\n/).forEach((line, index) => {
    if (!line.trim()) { flush(); return; }
    if (marker.test(line)) flush();
    if (!lines.length) firstLine = index + 1;
    lines.push(line);
  });
  flush();
  if (passages.length > SOURCE_PASSAGE_LIMIT) throw new Error(messages.tooMany);
  return passages;
}

export function sourceAddress(value: string, locale: Locale) {
  if (!value.trim()) return undefined;
  const url = URL.canParse(value.trim()) ? new URL(value.trim()) : undefined;
  if (!url || !["http:", "https:"].includes(url.protocol) || url.username || url.password || url.href.length > 2048) {
    throw new Error(getWebMessages(locale).source.invalidUrl);
  }
  return url.href;
}

export function documentFromSource(name: string, text: string, address: string, locale: Locale) {
  const messages = getWebMessages(locale).source;
  const title = name.trim();
  if (!title || title.length > 120) throw new Error(messages.invalidName);
  const content = contentFromSource({ origin: "text", name: title, address, passages: sourcePassages(text, locale) }, locale);
  const root = createTopic(generateId("topic"), title, content);
  return createDocument([createSheet(generateId("sheet"), title, root)]);
}

export function contentFromSource({ origin, name, address, passages }: PassageSource, locale: Locale) {
  const messages = getWebMessages(locale).source;
  if (!passages.length) throw new Error(messages.empty);
  const url = origin === "web" ? undefined : sourceAddress(address, locale);
  const href = url ? { kind: "url" as const, target: url } : undefined;
  const children = passages.map((passage) => {
    const lines = origin === "text" ? messages.lines(passage.firstLine, passage.lastLine) : undefined;
    const citation = origin === "web" ? "" : [name, lines, url].filter(Boolean).join(" · ");
    const text = citation ? `${citation}\n\n${passage.quote}` : passage.quote;
    return createTopic(generateId("topic"), passage.title, { note: { format: "markdown", text }, ...(href ? { href } : {}) });
  });
  return { children, ...(href ? { href } : {}) };
}
