import { useRef, useState } from "react";
import { X } from "lucide-react";
import { authRequest } from "./session.js";
import type { AuthUser, Session } from "./shared.js";
import type { SyncState } from "../drafts/workspace.js";

export function AccountControl({ user, onSessionChange, sync, onSync, onLogin }: {
  user: AuthUser | null;
  onSessionChange: (session: Session) => void;
  sync: SyncState;
  onSync: (useCloud?: boolean) => void;
  onLogin: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function logout() {
    setBusy(true);
    setError("");
    try {
      const session = await authRequest<Session>("logout");
      dialog.current?.close();
      onSessionChange(session);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "退出失败，请重试。");
    } finally {
      setBusy(false);
    }
  }

  if (!user) return <button type="button" onClick={onLogin} className="lm-editor-account">Google 登录</button>;
  const synced = sync.label === "已同步" || sync.label === "云端就绪";
  return <>
    <button
      type="button"
      onClick={() => dialog.current?.showModal()}
      title={`${user.email} · ${sync.detail}`}
      className="lm-editor-account"
    >
      <span className={`lm-sync-dot ${synced ? "is-ok" : "is-warn"}`} aria-hidden="true" />
      <span>{sync.label}</span>
    </button>
    <dialog ref={dialog} aria-labelledby="lm-account-title" onCancel={(event) => { if (busy) event.preventDefault(); }}
      className="lm-account-dialog">
      <div className="lm-account-heading">
        <h2 id="lm-account-title">账号与同步</h2>
        <button type="button" className="lm-icon-button-sm" aria-label="关闭" disabled={busy} onClick={() => dialog.current?.close()}><X size={14}/></button>
      </div>
      <p className="lm-account-email">{user.email}</p>
      <div className="lm-account-sync"><span>{sync.label}</span><p role="status">{sync.detail}</p></div>
      {sync.conflict ? <button type="button" className="lm-text-button" onClick={() => {
        if (window.confirm("打开云端草稿会替换本机修改。请先导出备份。继续吗？")) onSync(true);
      }}>打开云端版本…</button> : <button type="button" className="lm-text-button" disabled={sync.label === "同步中"} onClick={() => onSync()}>立即同步</button>}
      {!synced && <p className="lm-account-hint">退出前请确认导图已同步；本机修改不会自动出现在其他设备。</p>}
      <button type="button" className="lm-secondary-button lm-wide-button" disabled={busy} onClick={() => void logout()}>退出登录</button>
      {error && <p className="lm-form-error" role="alert">{error}</p>}
    </dialog>
  </>;
}
