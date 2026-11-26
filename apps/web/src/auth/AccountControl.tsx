import { useRef, useState } from "react";
import { X } from "lucide-react";
import { useI18n } from "../i18n.js";
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
  const { t } = useI18n();
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
      setError(reason instanceof Error ? reason.message : t.account.logoutFailed);
    } finally {
      setBusy(false);
    }
  }

  if (!user) return <button type="button" onClick={onLogin} className="lm-editor-account">{t.account.googleLogin}</button>;
  const synced = sync.status ? (sync.status === "synced" || sync.status === "ready") : (sync.label === "已同步" || sync.label === "云端就绪");
  const syncing = sync.status ? sync.status === "syncing" : sync.label === "同步中";
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
        <h2 id="lm-account-title">{t.account.title}</h2>
        <button type="button" className="lm-icon-button-sm" aria-label={t.common.close} disabled={busy} onClick={() => dialog.current?.close()}><X size={14}/></button>
      </div>
      <p className="lm-account-email">{user.email}</p>
      <div className="lm-account-sync"><span>{sync.label}</span><p role="status">{sync.detail}</p></div>
      {sync.conflict ? <button type="button" className="lm-text-button" onClick={() => {
        if (window.confirm(t.account.openCloudConfirm)) onSync(true);
      }}>{t.account.openCloudBtn}</button> : <button type="button" className="lm-text-button" disabled={syncing} onClick={() => onSync()}>{t.account.syncNow}</button>}
      {!synced && <p className="lm-account-hint">{t.account.unsyncedHint}</p>}
      <button type="button" className="lm-secondary-button lm-wide-button" disabled={busy} onClick={() => void logout()}>{t.account.logout}</button>
      {error && <p className="lm-form-error" role="alert">{error}</p>}
    </dialog>
  </>;
}
