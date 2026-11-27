import { useEffect, useRef, useState } from "react";
import { Check, Copy, Link2, X } from "lucide-react";
import { getIntlLocale } from "@mindmap/core";
import { createShare, listShares, publicLink, revokeShare, type CreatedShare, type ShareSummary } from "./api.js";
import { useI18n } from "./i18n.js";

export interface ShareTarget { type: "workspace" | "mindmap"; id: string; name: string }

function LinkField({ id, label, copyLabel, url }: { id: string; label: string; copyLabel: string; url: string }) {
  const { t } = useI18n();
  const input = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<"idle" | "copied" | "manual">("idle");
  async function copy() {
    try { await navigator.clipboard.writeText(url); setStatus("copied"); }
    catch { input.current?.focus(); input.current?.select(); setStatus("manual"); }
  }
  return <div className="lm-created-link"><label htmlFor={id}>{label}</label>
    <div><input id={id} ref={input} readOnly value={url}/><button type="button" onClick={() => void copy()} aria-label={copyLabel}>{status === "copied" ? <Check size={17}/> : <Copy size={17}/>}</button></div>
    {status === "manual" && <p className="lm-form-error" role="status">{t.shareDialog.copyError}</p>}
  </div>;
}

function PublicLinkControls({ id }: { id: string }) {
  const { t } = useI18n();
  const [token, setToken] = useState<string | null>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setError("");
    void publicLink(id, "GET").then((value) => { if (active) setToken(value.token); }).catch((reason) => {
      if (active) setError(reason instanceof Error ? reason.message : t.shareDialog.listError);
    });
    return () => { active = false; };
  }, [id, attempt, t.shareDialog.listError]);
  async function change() {
    if (busy || token === undefined || (token && !window.confirm(t.shareDialog.disableConfirm))) return;
    setBusy(true);
    setError("");
    try { setToken((await publicLink(id, token ? "DELETE" : "PUT")).token); }
    catch (reason) { setToken(undefined); setError(reason instanceof Error ? reason.message : t.shareDialog.listError); }
    finally { setBusy(false); }
  }
  return <section className="lm-public-link" aria-labelledby="lm-public-link-title">
    <h3 id="lm-public-link-title">{t.shareDialog.publicTitle}</h3><p className="lm-modal-description">{t.shareDialog.publicDesc}</p>
    {token && <LinkField key={token} id="lm-public-url" label={t.shareDialog.publicUrl} copyLabel={t.shareDialog.copyPublic} url={`${location.origin}/view/${id}#${token}`}/>}
    {error ? <><p className="lm-form-error" role="alert">{error}</p><button type="button" className="lm-secondary-button" onClick={() => setAttempt((value) => value + 1)}>{t.common.retry}</button></>
      : <button type="button" className="lm-secondary-button" disabled={busy || token === undefined} onClick={() => void change()}>{token ? t.shareDialog.disablePublic : t.shareDialog.enablePublic}</button>}
  </section>;
}

export function ShareDialog({ target, onClose }: { target: ShareTarget | null; onClose: () => void }) {
  const { locale, t } = useI18n();
  const dialog = useRef<HTMLDialogElement>(null);
  const [role, setRole] = useState<"viewer" | "editor">("editor");
  const [links, setLinks] = useState<ShareSummary[]>([]);
  const [created, setCreated] = useState<CreatedShare | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!target) { dialog.current?.close(); return; }
    dialog.current?.showModal();
    let active = true;
    setCreated(null);
    setError("");
    setLinks([]);
    void listShares(target.type, target.id).then((value) => { if (active) setLinks(value); }).catch((reason) => {
      if (active) setError(reason instanceof Error ? reason.message : t.shareDialog.listError);
    });
    return () => { active = false; };
  }, [target?.type, target?.id, t.shareDialog.listError]);

  async function create() {
    if (!target || busy) return;
    setBusy(true);
    setError("");
    try {
      const link = await createShare(target.type, target.id, role);
      setCreated(link);
      setLinks((current) => [link, ...current]);
    } catch (reason) { setError(reason instanceof Error ? reason.message : t.shareDialog.createError); }
    finally { setBusy(false); }
  }

  async function revoke(id: string) {
    if (!window.confirm(t.shareDialog.revokeConfirm)) return;
    setBusy(true);
    setError("");
    try {
      await revokeShare(id);
      setLinks((current) => current.filter((link) => link.id !== id));
      if (created?.id === id) setCreated(null);
    } catch (reason) { setError(reason instanceof Error ? reason.message : t.shareDialog.revokeError); }
    finally { setBusy(false); }
  }

  return <dialog ref={dialog} className="lm-modal" aria-labelledby="lm-share-title" onClose={onClose}>
    {target && <div className="lm-modal-inner">
      <div className="lm-modal-heading"><div><span className="lm-eyebrow">{t.shareDialog.eyebrow}</span><h2 id="lm-share-title">{target.type === "workspace" ? t.shareDialog.shareWorkspace : t.shareDialog.shareMap}</h2></div>
        <button type="button" className="lm-icon-button-sm" aria-label={t.common.close} onClick={() => dialog.current?.close()}><X size={15}/></button></div>
      {target.type === "mindmap" && <PublicLinkControls key={target.id} id={target.id}/>}
      <p className="lm-modal-description">{t.shareDialog.desc(target.name)}</p>
      <div className="lm-share-roles" role="group" aria-label={t.shareDialog.roleAria}>
        <button type="button" aria-pressed={role === "editor"} onClick={() => setRole("editor")}><strong>{t.common.canEdit}</strong><span>{t.shareDialog.editorDesc}</span></button>
        <button type="button" aria-pressed={role === "viewer"} onClick={() => setRole("viewer")}><strong>{t.common.canView}</strong><span>{t.shareDialog.viewerDesc}</span></button>
      </div>
      <button type="button" className="lm-primary-button lm-wide-button" disabled={busy} onClick={() => void create()}><Link2 size={16}/> {t.shareDialog.createLink}</button>
      {created && <LinkField key={created.id} id="lm-share-url" label={t.shareDialog.newLinkLabel} copyLabel={t.shareDialog.copyAria} url={`${location.origin}/invite/${created.token}`}/>}
      {!!links.length && <div className="lm-share-existing"><span className="lm-eyebrow">ACTIVE LINKS / {links.length}</span>
        {links.map((link) => <div key={link.id}><span>{link.role === "editor" ? t.common.canEdit : t.common.canView} · {t.shareDialog.expiresOn(new Date(link.expiresAt).toLocaleDateString(getIntlLocale(locale)))}</span>
          <button type="button" disabled={busy} onClick={() => void revoke(link.id)}>{t.shareDialog.revoke}</button></div>)}
      </div>}
      {error && <p className="lm-form-error" role="alert">{error}</p>}
    </div>}
  </dialog>;
}
