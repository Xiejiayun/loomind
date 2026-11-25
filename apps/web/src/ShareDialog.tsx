import { useEffect, useRef, useState } from "react";
import { Check, Copy, Link2, X } from "lucide-react";
import { createShare, listShares, revokeShare, type CreatedShare, type ShareSummary } from "./api.js";

export interface ShareTarget { type: "workspace" | "mindmap"; id: string; name: string }

export function ShareDialog({ target, onClose }: { target: ShareTarget | null; onClose: () => void }) {
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
      if (active) setError(reason instanceof Error ? reason.message : "无法读取分享链接。");
    });
    return () => { active = false; };
  }, [target?.type, target?.id]);

  async function create() {
    if (!target || busy) return;
    setBusy(true);
    setError("");
    setCopied(false);
    try {
      const link = await createShare(target.type, target.id, role);
      setCreated(link);
      setLinks((current) => [link, ...current]);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "创建分享链接失败。"); }
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
      setError("浏览器未允许复制，请手动复制下方链接。");
    }
  }

  async function revoke(id: string) {
    if (!window.confirm("撤销后，这个邀请链接将无法再使用。继续吗？")) return;
    setBusy(true);
    setError("");
    try {
      await revokeShare(id);
      setLinks((current) => current.filter((link) => link.id !== id));
      if (created?.id === id) setCreated(null);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "无法撤销分享链接。"); }
    finally { setBusy(false); }
  }

  return <dialog ref={dialog} className="lm-modal" aria-labelledby="lm-share-title" onClose={onClose}>
    {target && <div className="lm-modal-inner">
      <div className="lm-modal-heading"><div><span className="lm-eyebrow">SHARE / INVITE</span><h2 id="lm-share-title">共享{target.type === "workspace" ? "工作区" : "导图"}</h2></div>
        <button type="button" className="lm-icon-button" aria-label="关闭" onClick={() => dialog.current?.close()}><X size={18}/></button></div>
      <p className="lm-modal-description">为「{target.name}」创建邀请链接。受邀者登录后即可加入；链接 7 天有效，随时可撤销。</p>
      <div className="lm-share-roles" role="group" aria-label="邀请权限">
        <button type="button" aria-pressed={role === "editor"} onClick={() => setRole("editor")}><strong>可编辑</strong><span>查看并修改内容</span></button>
        <button type="button" aria-pressed={role === "viewer"} onClick={() => setRole("viewer")}><strong>可查看</strong><span>仅查看导图</span></button>
      </div>
      <button type="button" className="lm-primary-button lm-wide-button" disabled={busy} onClick={() => void create()}><Link2 size={16}/> 创建邀请链接</button>
      {created && <div className="lm-created-link"><label htmlFor="lm-share-url">新链接（关闭后不再显示）</label><div><input id="lm-share-url" ref={linkInput} readOnly value={`${location.origin}/invite/${created.token}`}/><button type="button" onClick={() => void copy()} aria-label="复制邀请链接">{copied ? <Check size={17}/> : <Copy size={17}/>}</button></div></div>}
      {!!links.length && <div className="lm-share-existing"><span className="lm-eyebrow">ACTIVE LINKS / {links.length}</span>
        {links.map((link) => <div key={link.id}><span>{link.role === "editor" ? "可编辑" : "可查看"} · {new Date(link.expiresAt).toLocaleDateString("zh-CN")} 到期</span>
          <button type="button" disabled={busy} onClick={() => void revoke(link.id)}>撤销</button></div>)}
      </div>}
      {error && <p className="lm-form-error" role="alert">{error}</p>}
    </div>}
  </dialog>;
}
