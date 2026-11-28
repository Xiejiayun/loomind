import { useEffect, useMemo, useRef, useState } from "react";
import { Globe, TextQuote, X } from "lucide-react";
import { readWebpage, webpageOrigins } from "./api.js";
import type { SourceAttachment } from "./composer-attachments.js";
import { useI18n } from "./i18n.js";
import { passageLocation, sourceAddress, sourcePassages, webpagePassages, type CitedPassage } from "./source-material.js";
import type { WebpageSource } from "./webpage-contract.js";

export function PassagePreview({ passages }: { passages: CitedPassage[] }) {
  const { locale, t } = useI18n();
  return <div className="lm-attachment-quotes" aria-label={t.source.preview}>
    {passages.map((passage) => <details key={`${passage.page ?? 0}:${passage.paragraph ?? passage.firstLine}`}>
      <summary>{passageLocation(passage, locale)} · {passage.title}</summary><p>{passage.quote}</p>
    </details>)}
  </div>;
}

export type SourceMode = "text" | "web";

export function SourceAttachmentEditor({ mode, onAttach, onCancel }: {
  mode: SourceMode; onAttach: (source: SourceAttachment) => void; onCancel: () => void;
}) {
  const { locale, t } = useI18n();
  const messages = t.source;
  const [text, setText] = useState("");
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [webpage, setWebpage] = useState<WebpageSource>();
  const [publishers, setPublishers] = useState<string[]>([]);
  const [publisherError, setPublisherError] = useState("");
  const [reading, setReading] = useState(false);
  const [failure, setFailure] = useState("");
  const version = useRef(0);
  const isWeb = mode === "web";
  const preview = useMemo(() => {
    try {
      if (isWeb) return { passages: webpagePassages(webpage?.paragraphs ?? []), error: "" };
      sourceAddress(address, locale);
      return { passages: sourcePassages(text, locale), error: "" };
    } catch (reason) { return { passages: [], error: reason instanceof Error ? reason.message : messages.empty }; }
  }, [text, address, locale, isWeb, webpage, messages]);

  useEffect(() => {
    if (!isWeb) return;
    let active = true;
    webpageOrigins().then((items) => { if (active) setPublishers(items); }, () => { if (active) setPublisherError(messages.webErrors.unavailable); });
    return () => { active = false; version.current++; };
  }, [isWeb, messages]);

  async function read() {
    const request = ++version.current;
    setWebpage(undefined); setFailure(""); setReading(true);
    try {
      const result = await readWebpage(address.trim());
      if (request === version.current) setWebpage(result);
    } catch (reason) {
      if (request === version.current) {
        const key = reason instanceof Error ? reason.message : "";
        setFailure(Object.hasOwn(messages.webErrors, key) ? messages.webErrors[key as keyof typeof messages.webErrors] : messages.webErrors.unavailable);
      }
    } finally { if (request === version.current) setReading(false); }
  }

  const title = (name.trim() || preview.passages[0]?.title || "").slice(0, 120);
  return <section className="lm-attachment-panel lm-source-draft" aria-label={isWeb ? messages.web : messages.paste} onKeyDown={(event) => {
    if (event.key === "Escape") { event.preventDefault(); onCancel(); }
    if (event.key === "Enter" && event.target instanceof HTMLInputElement) {
      event.preventDefault(); if (isWeb && address.trim() && !reading) void read();
    }
  }}>
    <div className="lm-attachment-heading"><strong>{isWeb ? <Globe size={15}/> : <TextQuote size={15}/>} {isWeb ? messages.web : messages.paste}</strong>
      <button type="button" className="lm-attachment-icon" aria-label={t.common.cancel} onClick={onCancel}><X size={15}/></button></div>
    {isWeb ? <>
      <label>{messages.webUrl}<input autoFocus type="text" inputMode="url" placeholder="https://…" value={address} onChange={(event) => {
        version.current++; setAddress(event.target.value); setWebpage(undefined); setFailure(""); setReading(false);
      }}/></label>
      <small>{messages.webHint}</small>{publishers.length > 0 && <small>{messages.publishers} {publishers.map((url) => new URL(url).host).join(", ")}</small>}
      {publisherError && <p role="alert">{publisherError}</p>}
      {!webpage && <button className="lm-secondary-button" type="button" disabled={!address.trim() || reading} onClick={() => void read()}>{reading ? messages.webReading : messages.webRead}</button>}
      {webpage && <p role="status">{webpage.title} · {messages.webReady} {webpage.url}{webpage.truncated && <> · {messages.webTruncated}</>}</p>}
      {webpage && <small>{messages.webPrivacy}</small>}
    </> : <>
      <label>{messages.text}<textarea autoFocus value={text} placeholder={messages.hint} onChange={(event) => setText(event.target.value)}/></label>
      <div className="lm-attachment-fields"><label>{messages.name}<input value={name} placeholder={preview.passages[0]?.title} maxLength={120} onChange={(event) => setName(event.target.value)}/></label>
        <label>{messages.url}<input inputMode="url" value={address} onChange={(event) => setAddress(event.target.value)}/></label></div>
    </>}
    {(preview.error || failure) && <p className="lm-form-error" role="alert">{preview.error || failure}</p>}
    {preview.passages.length > 0 && <PassagePreview passages={preview.passages}/>}
    {(!isWeb || webpage) && <button type="button" className="lm-secondary-button" disabled={!preview.passages.length || !title} onClick={() => onAttach({
      kind: "source", origin: mode, title, name: webpage?.title || title, address: webpage?.url ?? address, passages: preview.passages,
      summary: webpage?.truncated ? messages.webTruncated : undefined,
    })}>{t.attachments.attach}</button>}
  </section>;
}
