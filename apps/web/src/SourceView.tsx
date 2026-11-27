import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { ArrowRight } from "lucide-react";
import type { MindmapDocument } from "@mindmap/core/model";
import { readWebpage, webpageOrigins, type WorkspaceSummary } from "./api.js";
import { useI18n } from "./i18n.js";
import { AppLink } from "./navigation.js";
import { documentFromPassages, passageLocation, SOURCE_TEXT_LIMIT, sourceAddress, sourcePassages, webpagePassages, type CitedPassage } from "./source-material.js";
import type { PdfSource } from "./pdf-source.js";
import type { WebpageSource } from "./webpage-contract.js";

type SourceMode = "text" | "pdf" | "web";

export function SourceView({ workspaces, activeWorkspaceId, onCreate }: {
  workspaces: WorkspaceSummary[]; activeWorkspaceId: string | null;
  onCreate: (document: MindmapDocument, workspaceId: string | null) => Promise<void>;
}) {
  const { t, locale } = useI18n();
  const messages = t.source;
  const writable = workspaces.filter((space) => space.role !== "viewer");
  const [workspaceId, setWorkspaceId] = useState<string | null>(() => writable.find((space) => space.id === activeWorkspaceId)?.id ?? null);
  const [name, setName] = useState("");
  const [text, setText] = useState("");
  const [address, setAddress] = useState("");
  const [mode, setMode] = useState<SourceMode>("text");
  const [pdf, setPdf] = useState<PdfSource>();
  const [webUrl, setWebUrl] = useState("");
  const [webpage, setWebpage] = useState<WebpageSource>();
  const [publishers, setPublishers] = useState<string[]>([]);
  const [publisherError, setPublisherError] = useState("");
  const [reading, setReading] = useState(false);
  const readVersion = useRef(0);
  const autoTitle = useRef("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");
  const preview = useMemo(() => {
    try {
      if (mode === "web") return { passages: webpagePassages(webpage?.paragraphs ?? []), error: "" };
      sourceAddress(address, locale); const passages: CitedPassage[] = mode === "pdf" ? pdf?.passages ?? [] : sourcePassages(text, locale); return { passages, error: "" };
    }
    catch (reason) { return { passages: [], error: reason instanceof Error ? reason.message : messages.empty }; }
  }, [text, address, locale, messages, mode, pdf, webpage]);

  useEffect(() => {
    if (mode !== "web") return;
    let active = true;
    setPublisherError("");
    webpageOrigins().then((items) => { if (active) setPublishers(items); }, () => { if (active) setPublisherError(messages.webErrors.unavailable); });
    return () => { active = false; };
  }, [mode, messages]);

  function changeMode(next: SourceMode) {
    if (next === mode) return;
    readVersion.current++; setReading(false); setFailure(""); setMode(next);
  }

  function suggestName(title: string) {
    const previous = autoTitle.current;
    autoTitle.current = title;
    setName((current) => !current.trim() || current === previous ? title : current);
  }

  async function selectWebpage() {
    const version = ++readVersion.current;
    setWebpage(undefined); setFailure(""); setReading(true);
    try {
      const result = await readWebpage(webUrl.trim());
      if (version === readVersion.current) { setWebpage(result); suggestName(result.title); }
    } catch (reason) {
      if (version === readVersion.current) {
        const key = reason instanceof Error ? reason.message : "";
        setFailure(Object.hasOwn(messages.webErrors, key) ? messages.webErrors[key as keyof typeof messages.webErrors] : messages.webErrors.unavailable);
      }
    } finally { if (version === readVersion.current) setReading(false); }
  }

  async function selectPdf(file?: File) {
    const version = ++readVersion.current;
    setPdf(undefined); setFailure(""); setReading(Boolean(file));
    if (!file) return;
    try {
      const { readPdfSource } = await import("./pdf-source.js");
      const result = await readPdfSource(file, locale);
      if (version === readVersion.current) {
        setPdf(result); suggestName(file.name.replace(/\.pdf$/i, "").slice(0, 120));
      }
    } catch (reason) {
      if (version === readVersion.current) setFailure(reason instanceof Error ? reason.message : messages.pdfInvalid);
    } finally { if (version === readVersion.current) setReading(false); }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || reading || preview.error || !preview.passages.length) return;
    setBusy(true); setFailure("");
    try { await onCreate(documentFromPassages(name, preview.passages, mode === "web" ? webpage!.url : address, locale, mode === "web" ? webpage?.title : mode === "pdf" ? pdf?.filename : undefined), workspaceId); }
    catch (reason) { setFailure(reason instanceof Error ? reason.message : t.createView.createError); }
    finally { setBusy(false); }
  }

  return <form className="lm-content lm-create-view lm-source-view" onSubmit={(event) => void submit(event)}>
    <div className="lm-page-heading"><div><h1>{messages.heading}</h1><p>{messages.description}</p></div>
      <AppLink href="/app" className="lm-secondary-button">{t.createView.backWorkspace}</AppLink></div>
    <div className="lm-create-tabs" role="group" aria-label={messages.heading}>
      <button type="button" aria-pressed={mode === "text"} onClick={() => changeMode("text")}>{messages.paste}</button>
      <button type="button" aria-pressed={mode === "pdf"} onClick={() => changeMode("pdf")}>{messages.pdf}</button>
      <button type="button" aria-pressed={mode === "web"} onClick={() => changeMode("web")}>{messages.web}</button>
    </div>
    <div className="lm-create-grid"><section className="lm-create-input-panel" aria-label={messages.heading}>
      <label htmlFor="lm-source-name">{messages.name}</label><input id="lm-source-name" value={name} onChange={(event) => setName(event.target.value)} maxLength={120} required/>
      {mode !== "web" && <><label htmlFor="lm-source-url">{messages.url}</label><input id="lm-source-url" inputMode="url" value={address} onChange={(event) => setAddress(event.target.value)}/></>}
      {mode === "text" ? <><label htmlFor="lm-source-text">{messages.text}</label><textarea id="lm-source-text" className="lm-create-textarea" value={text} onChange={(event) => setText(event.target.value)} required/>
        <div className="lm-field-foot"><span>{messages.hint}</span><span>{text.length} / {SOURCE_TEXT_LIMIT.toLocaleString(locale)}</span></div></> : mode === "web" ? <>
        <label htmlFor="lm-source-web">{messages.webUrl}</label><input id="lm-source-web" type="url" value={webUrl} onChange={(event) => { readVersion.current++; setWebUrl(event.target.value); setWebpage(undefined); setReading(false); setFailure(""); }}/>
        <p>{messages.webHint}</p>{publishers.length > 0 && <p>{messages.publishers} {publishers.map((url) => new URL(url).host).join(", ")}</p>}
        {publisherError && <p role="alert">{publisherError}</p>}
        <button type="button" className="lm-secondary-button" onClick={() => void selectWebpage()} disabled={!webUrl.trim() || reading || busy}>{reading ? messages.webReading : messages.webRead}</button>
        {webpage && <p role="status">{messages.webReady} {webpage.url}{webpage.truncated && <> · {messages.webTruncated}</>}</p>}
      </> : <>
        <label htmlFor="lm-source-pdf">{messages.pdfFile}</label><input id="lm-source-pdf" type="file" accept="application/pdf,.pdf" onChange={(event) => void selectPdf(event.target.files?.[0])}/>
        <p>{messages.pdfHint}</p><p role="status">{reading ? messages.pdfReading : pdf ? `${pdf.filename} · ${messages.pdfSummary(pdf.pages, pdf.emptyPages)}` : ""}</p>
      </>}
      {preview.error && <p className="lm-form-error" role="alert">{preview.error}</p>}
    </section><section className="lm-create-preview-panel" aria-label={messages.preview}><h2>{messages.preview}</h2>
      <div className="lm-structure-preview">{preview.passages.length ? preview.passages.map((passage) => <details key={`${passage.page ?? 0}:${passage.paragraph ?? passage.firstLine}`}>
        <summary>{passageLocation(passage, locale)} · {passage.title}</summary><p>{passage.quote}</p>
      </details>) : <p>{mode === "pdf" ? messages.pdfFile : mode === "web" ? messages.webPreview : messages.empty}</p>}</div>
      <div className="lm-create-settings"><label htmlFor="lm-source-space">{t.createView.saveToLabel}</label>
        <select id="lm-source-space" value={workspaceId ?? ""} onChange={(event) => setWorkspaceId(event.target.value || null)}>
          <option value="">{t.common.myMaps}</option>{writable.map((space) => <option key={space.id} value={space.id}>{space.name}</option>)}
        </select></div>
    </section></div>
    <div className="lm-create-actions"><span>{messages.privacy}</span><button type="submit" className="lm-primary-button" disabled={busy || !name.trim() || !preview.passages.length}>
      {busy ? t.createView.creating : messages.create}<ArrowRight size={17}/></button></div>
    {failure && <p className="lm-form-error" role="alert">{failure}</p>}
  </form>;
}
