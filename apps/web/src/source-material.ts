import { createDocument, createSheet, createTopic, generateId, type Locale } from "@mindmap/core";
import { getWebMessages } from "./i18n.js";

export const SOURCE_TEXT_LIMIT = 16_000;
export const SOURCE_PASSAGE_LIMIT = 80;
const marker = /^\s*(?:#{1,6}\s+|[-*+•]\s+|\d+[.)]\s+|\d+、\s*)/u;

export interface SourcePassage { title: string; quote: string; firstLine: number; lastLine: number }

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
    const characters = Array.from(first);
    passages.push({ title: characters.length > 72 ? `${characters.slice(0, 71).join("")}…` : first,
      quote, firstLine, lastLine: firstLine + lines.length - 1 });
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
  const passages = sourcePassages(text, locale);
  if (!passages.length) throw new Error(messages.empty);
  const url = sourceAddress(address, locale);
  const href = url ? { kind: "url" as const, target: url } : undefined;
  const children = passages.map((passage) => {
    const location = messages.lines(passage.firstLine, passage.lastLine);
    const citation = [title, location, url].filter(Boolean).join(" · ");
    return createTopic(generateId("topic"), passage.title, { note: { format: "markdown", text: `${citation}\n\n${passage.quote}` }, ...(href ? { href } : {}) });
  });
  const root = createTopic(generateId("topic"), title, { children, ...(href ? { href } : {}) });
  return createDocument([createSheet(generateId("sheet"), title, root)]);
}
