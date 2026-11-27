import { useEffect, useRef, useState } from "react";
import { Check, Copy, Link2, X } from "lucide-react";
import { getIntlLocale } from "@mindmap/core";
import { createShare, listShares, revokeShare, type CreatedShare, type ShareSummary } from "./api.js";
import { useI18n } from "./i18n.js";

export interface ShareTarget { type: "workspace" | "mindmap"; id: string; name: string }

export function ShareDialog({ target, onClose }: { target: ShareTarget | null; onClose: () => void }) {
  const { locale, t } = useI18n();
  const dialog = useRef<HTMLDialogElement>(null);
  const linkInput = useRef<HTMLInputElement>(null);
  const [role, setRole] = useState<"viewer" | "editor">("editor");
  const [links, setLinks] = useState<ShareSummary[]>([]);
  const [created, setCreated] = useState<CreatedShare | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

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
    setCopied(false);
    try {
      const link = await createShare(target.type, target.id, role);
      setCreated(link);
      setLinks((current) => [link, ...current]);
    } catch (reason) { setError(reason instanceof Error ? reason.message : t.shareDialog.createError); }
    finally { setBusy(false); }
  }

  async function copy() {
    if (!created) return;
    const url = `${location.origin}/invite/${created.token}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      linkInput.current?.focus();
      linkInput.current?.select();
      setError(t.shareDialog.copyError);
    }
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
      <p className="lm-modal-description">{t.shareDialog.desc(target.name)}</p>
      <div className="lm-share-roles" role="group" aria-label={t.shareDialog.roleAria}>
        <button type="button" aria-pressed={role === "editor"} onClick={() => setRole("editor")}><strong>{t.common.canEdit}</strong><span>{t.shareDialog.editorDesc}</span></button>
        <button type="button" aria-pressed={role === "viewer"} onClick={() => setRole("viewer")}><strong>{t.common.canView}</strong><span>{t.shareDialog.viewerDesc}</span></button>
      </div>
      <button type="button" className="lm-primary-button lm-wide-button" disabled={busy} onClick={() => void create()}><Link2 size={16}/> {t.shareDialog.createLink}</button>
      {created && <div className="lm-created-link"><label htmlFor="lm-share-url">{t.shareDialog.newLinkLabel}</label><div><input id="lm-share-url" ref={linkInput} readOnly value={`${location.origin}/invite/${created.token}`}/><button type="button" onClick={() => void copy()} aria-label={t.shareDialog.copyAria}>{copied ? <Check size={17}/> : <Copy size={17}/>}</button></div></div>}
      {!!links.length && <div className="lm-share-existing"><span className="lm-eyebrow">ACTIVE LINKS / {links.length}</span>
        {links.map((link) => <div key={link.id}><span>{link.role === "editor" ? t.common.canEdit : t.common.canView} · {t.shareDialog.expiresOn(new Date(link.expiresAt).toLocaleDateString(getIntlLocale(locale)))}</span>
          <button type="button" disabled={busy} onClick={() => void revoke(link.id)}>{t.shareDialog.revoke}</button></div>)}
      </div>}
      {error && <p className="lm-form-error" role="alert">{error}</p>}
    </div>}
  </dialog>;
}
