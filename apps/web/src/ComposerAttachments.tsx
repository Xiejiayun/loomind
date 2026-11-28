import { useEffect, useRef, useState } from "react";
import { FileText, Globe, LoaderCircle, Paperclip, Plus, TextQuote, X } from "lucide-react";
import type { Locale } from "@mindmap/core";
import { ATTACHMENT_ACCEPT, MAX_ATTACHMENTS, readAttachment, type ComposerAttachment, type SourceAttachment } from "./composer-attachments.js";
import { getWebMessages, useI18n } from "./i18n.js";
import { sourceAddress } from "./source-material.js";
import { PassagePreview, type SourceMode } from "./SourceAttachmentEditor.js";

interface AttachmentRow { id: string; name: string; value?: ComposerAttachment; error?: string }

function addressError(row: AttachmentRow, locale: Locale) {
  try { if (row.value?.kind === "source" && row.value.origin !== "web") sourceAddress(row.value.address, locale); }
  catch { return getWebMessages(locale).source.invalidUrl; }
  return "";
}

export function useComposerAttachments(locale: Locale) {
  const [rows, setRows] = useState<AttachmentRow[]>([]);
  const [notice, setNotice] = useState("");
  const messages = getWebMessages(locale).attachments;
  function hasRoom(count: number) {
    const fits = rows.length + count <= MAX_ATTACHMENTS;
    setNotice(fits ? "" : messages.limit(MAX_ATTACHMENTS));
    return fits;
  }
  async function addFiles(files: File[]) {
    if (!files.length || !hasRoom(files.length)) return;
    const entries = files.map((file) => ({ id: crypto.randomUUID(), name: file.name }));
    setRows((current) => [...current, ...entries]);
    for (const [index, entry] of entries.entries()) {
      let updated: AttachmentRow;
      try { updated = { ...entry, value: await readAttachment(files[index], locale) }; }
      catch (reason) { updated = { ...entry, error: reason instanceof Error ? reason.message : messages.unreadable }; }
      setRows((current) => current.map((row) => row.id === entry.id ? updated : row));
    }
  }
  function addSource(source: SourceAttachment) {
    if (!hasRoom(1)) return false;
    setRows((current) => [...current, { id: crypto.randomUUID(), name: source.name, value: source }]);
    return true;
  }
  function remove(id: string) { setRows((current) => current.filter((row) => row.id !== id)); setNotice(""); }
  function setAddress(id: string, address: string) {
    setRows((current) => current.map((row) => row.id === id && row.value?.kind === "source" ? { ...row, value: { ...row.value, address } } : row));
  }
  return { rows, notice, addFiles, addSource, remove, setAddress, blocked: rows.some((row) => !row.value || addressError(row, locale)) };
}

export function AttachmentButton({ disabled, onFiles, onSource }: {
  disabled: boolean; onFiles: (files: File[]) => void; onSource: (mode: SourceMode) => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const wrapper = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!wrapper.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); setOpen(false); trigger.current?.focus(); }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); };
  }, [open]);
  function choose(action: () => void) { setOpen(false); trigger.current?.focus(); action(); }
  return <div ref={wrapper} className="lm-attach-control" onBlur={(event) => {
    if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) setOpen(false);
  }}>
    <button id="lm-attach-trigger" ref={trigger} type="button" className="lm-attachment-icon lm-attach-trigger" aria-label={t.attachments.add}
      title={t.attachments.add} aria-expanded={open} aria-controls={open ? "lm-attach-options" : undefined} disabled={disabled} onClick={() => setOpen(!open)}><Plus size={19}/></button>
    {open && <div id="lm-attach-options" className="lm-attach-options" role="group" aria-label={t.attachments.add}>
      <button type="button" onClick={() => choose(() => input.current?.click())}><Paperclip size={17}/><span>{t.attachments.files}<small>{t.attachments.formats}</small></span></button>
      <button type="button" onClick={() => choose(() => onSource("text"))}><TextQuote size={17}/>{t.source.paste}</button>
      <button type="button" onClick={() => choose(() => onSource("web"))}><Globe size={17}/>{t.source.web}</button>
    </div>}
    <input hidden ref={input} type="file" accept={ATTACHMENT_ACCEPT} multiple aria-label={t.attachments.files} onChange={(event) => {
      const files = Array.from(event.target.files ?? []); event.target.value = ""; onFiles(files);
    }}/>
  </div>;
}

export function AttachmentTray({ draft, disabled }: { draft: ReturnType<typeof useComposerAttachments>; disabled: boolean }) {
  const { locale, t } = useI18n();
  const [expanded, setExpanded] = useState<string>();
  const selected = draft.rows.find((row) => row.id === expanded)?.value;
  return <>
    {draft.rows.length > 0 && <div className="lm-attachment-tray">
      <ul className="lm-attachment-list" aria-label={t.attachments.add}>{draft.rows.map((row) => {
        const value = row.value;
        const error = row.error || addressError(row, locale);
        const summary = value?.kind === "source" ? value.summary ?? t.attachments.passages(value.passages.length) : undefined;
        return <li key={row.id} className={`lm-attachment-chip${error ? " has-error" : ""}`}>
          <div className="lm-attachment-chip-head"><button type="button" disabled={!value || disabled} aria-expanded={expanded === row.id} aria-label={t.attachments.preview(row.name)} onClick={() => setExpanded(expanded === row.id ? undefined : row.id)}>
            {value?.kind === "image" ? <img alt="" src={`data:${value.asset.mimeType};base64,${value.asset.dataBase64}`}/> : !value && !error ? <LoaderCircle size={16}/> : <FileText size={16}/>}
            <span>{row.name}</span></button>
            <button type="button" className="lm-attachment-icon" disabled={disabled} aria-label={t.attachments.remove(row.name)} onClick={() => draft.remove(row.id)}><X size={14}/></button></div>
          {error ? <small role="alert">{error}</small> : (!value || summary) && <small role="status">{summary || t.attachments.reading}</small>}
        </li>;
      })}</ul>
      {selected && <div className="lm-attachment-panel" aria-label={t.attachments.preview(selected.name)}>
        {selected.kind === "image" ? <img className="lm-attachment-image" alt={selected.name} src={`data:${selected.asset.mimeType};base64,${selected.asset.dataBase64}`}/> : <>
          {selected.origin === "web" ? <><small>{selected.address}</small><small>{t.source.webPrivacy}</small></> : <label>{t.source.url}<input inputMode="url" disabled={disabled} value={selected.address} onChange={(event) => draft.setAddress(expanded!, event.target.value)}/></label>}
          {selected.origin === "pdf" && <small>{t.source.pdfHint}</small>}
          <PassagePreview passages={selected.passages}/>
        </>}
      </div>}
      <p className="lm-attachment-hint">{t.attachments.hint}</p>
    </div>}
    {draft.notice && <p className="lm-attachment-notice lm-form-error" role="alert">{draft.notice}</p>}
  </>;
}
