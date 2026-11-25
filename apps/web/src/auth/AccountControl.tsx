import { useRef, useState } from "react";
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
  return <>
    <button type="button" onClick={() => dialog.current?.showModal()} title={user.email}
      className="lm-editor-account">我的账号 <span>· {sync.label}</span></button>
    <dialog ref={dialog} aria-labelledby="lm-account-title" onCancel={(event) => { if (busy) event.preventDefault(); }}
      className="lm-account-dialog">
      <div className="lm-account-heading"><h2 id="lm-account-title">我的账号</h2><button type="button" disabled={busy} onClick={() => dialog.current?.close()}>关闭</button></div>
      <p className="lm-account-email">{user.email}</p>
      <div className="lm-account-sync"><span>{sync.label}</span><p role="status">{sync.detail}</p></div>
      {sync.conflict ? <button type="button" className="lm-text-button" onClick={() => {
        if (window.confirm("打开云端草稿会替换本机修改。请先导出备份。继续吗？")) onSync(true);
      }}>打开云端版本…</button> : <button type="button" className="lm-text-button" disabled={sync.label === "同步中"} onClick={() => onSync()}>立即同步</button>}
      {sync.label !== "已同步" && sync.label !== "云端就绪" && <p className="lm-account-hint">退出前请确认导图已同步；本机修改不会自动出现在其他设备。</p>}
      <button type="button" className="lm-secondary-button" disabled={busy} onClick={() => void logout()}>退出登录</button>
      {error && <p className="lm-form-error" role="alert">{error}</p>}
    </dialog>
  </>;
}
