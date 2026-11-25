import { useRef, useState } from "react";
import { Turnstile, type TurnstileInstance } from "@marsidev/react-turnstile";
import { GoogleLogin, GoogleOAuthProvider } from "@react-oauth/google";
import { authRequest } from "./session.js";
import { LOGIN_ACTION, type AuthUser, type LoginChallenge, type Session } from "./shared.js";
import type { SyncState } from "../drafts/workspace.js";
import type { MindmapSummary } from "../drafts/shared.js";

interface Props {
  user: AuthUser | null;
  onSessionChange: (session: Session) => void;
  sync: SyncState;
  onSync: (useCloud?: boolean) => void;
  maps: MindmapSummary[];
  selected: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
}

export function AccountControl({ user, onSessionChange, sync, onSync, maps, selected, onSelect, onCreate }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const widget = useRef<TurnstileInstance>(null);
  const attempt = useRef(0);
  const [challenge, setChallenge] = useState<LoginChallenge | null>(null);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function begin() {
    const current = ++attempt.current;
    setError("");
    setChallenge(null);
    setToken("");
    try {
      const next = await authRequest<LoginChallenge>("challenge");
      if (current === attempt.current) setChallenge(next);
    } catch (err) {
      if (current === attempt.current) setError((err as Error).message);
    }
  }

  async function submit(credential?: string) {
    if (!dialog.current?.open || busy) return;
    if (!credential || !token) { setError("请重新完成人机验证和 Google 登录。"); return; }
    setBusy(true);
    setError("");
    try {
      const next = await authRequest<Session>("google", "POST", { credential, turnstileToken: token });
      dialog.current.close();
      onSessionChange(next);
    } catch (err) {
      widget.current?.reset();
      setToken("");
      setChallenge(null);
      setError((err as Error).message);
    } finally { setBusy(false); }
  }

  async function logout() {
    setBusy(true);
    setError("");
    try {
      const next = await authRequest<Session>("logout");
      dialog.current?.close();
      onSessionChange(next);
    } catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  }

  return <>
    <button type="button" aria-haspopup="dialog" title={user?.email ?? "使用 Google 登录"}
      onClick={() => { dialog.current?.showModal(); if (!user) void begin(); }}
      className="shrink-0 whitespace-nowrap rounded-md border border-slate-400/50 px-2 py-1 font-medium hover:border-indigo-400">
      {user ? `我的账号 · ${sync.label}` : "Google 登录"}
    </button>
    <dialog ref={dialog} aria-labelledby="account-title" onCancel={(event) => { if (busy) event.preventDefault(); }}
      onClose={() => { ++attempt.current; setChallenge(null); setToken(""); setError(""); }}
      className="m-auto w-96 max-w-[calc(100vw-2rem)] rounded-2xl bg-white p-6 text-left text-sm text-slate-800 shadow-xl backdrop:bg-slate-950/40">
      <div className="mb-3 flex items-center justify-between gap-4">
        <h2 id="account-title" className="text-lg font-semibold">{user ? "我的 Loomind 账号" : "登录 Loomind"}</h2>
        <button type="button" disabled={busy} onClick={() => dialog.current?.close()} className="rounded px-2 py-1 text-slate-600 hover:bg-slate-100">关闭</button>
      </div>
      {user ? <>
        <p className="select-text break-all font-medium">{user.email}</p>
        <div className="my-4 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <h3 className="font-semibold">我的导图</h3>
            <button type="button" className="rounded border border-slate-300 px-2 py-1 hover:bg-slate-100" onClick={() => { onCreate(); dialog.current?.close(); }}>新建导图</button>
          </div>
          <div className="max-h-48 space-y-1 overflow-y-auto" role="list" aria-label="我的导图">
            {maps.map((map) => <button key={map.id} type="button" role="listitem" aria-current={selected === map.id ? "true" : undefined}
              onClick={() => { onSelect(map.id); dialog.current?.close(); }}
              className={`block w-full truncate rounded px-2 py-1.5 text-left hover:bg-slate-100 ${selected === map.id ? "bg-indigo-50 font-semibold text-indigo-800" : ""}`}>
              {map.title}
            </button>)}
          </div>
        </div>
        <p role="status" className="my-3 text-slate-600">{sync.detail}</p>
        <div className="mb-4">
          {sync.conflict ? <button type="button" className="underline" onClick={() => {
            if (window.confirm("打开云端草稿会替换本机修改。若尚未导出备份，请先取消。继续吗？")) onSync(true);
          }}>打开云端版本…</button> : <button type="button" className="underline" disabled={sync.label === "同步中"} onClick={() => onSync()}>立即同步</button>}
        </div>
        {sync.label !== "已同步" && sync.label !== "云端就绪" && <p className="mb-3 text-slate-600">退出前可先同步或导出备份；未同步的修改不会出现在其他设备。</p>}
        <button type="button" disabled={busy} onClick={logout} className="rounded-md border border-slate-300 px-3 py-2">退出登录</button>
      </> : <>
        <p className="mb-4 text-slate-600">完成人机验证后可使用 Google 登录，登录后的导图会同步到云端。现有游客草稿不会上传，退出登录后仍可在本机打开。</p>
        {challenge && <Turnstile key={challenge.nonce} ref={widget} siteKey={challenge.turnstileSiteKey}
          options={{ action: LOGIN_ACTION, size: "flexible", theme: "light" }}
          onSuccess={(value) => { setToken(value); setError(""); }} onExpire={() => setToken("")}
          onTimeout={() => { setToken(""); setError("验证已超时，请重试。"); }}
          onError={() => { setToken(""); setError("人机验证未完成，请重试。"); }}
          scriptOptions={{ onError: () => setError("未能加载人机验证，请检查网络后刷新页面。") }} />}
        {challenge && token && !busy && <div className="mt-3">
          <GoogleOAuthProvider clientId={challenge.googleClientId} locale="zh_CN"
            onScriptLoadError={() => setError("未能加载 Google 登录，请检查网络后重试。") }>
            <GoogleLogin nonce={challenge.nonce} text="continue_with" onSuccess={({ credential }) => void submit(credential)}
              onError={() => setError("Google 登录未完成，请重试。")} />
          </GoogleOAuthProvider>
        </div>}
        {!challenge && !error && !busy && <p role="status">正在准备登录…</p>}
      </>}
      {busy && <p role="status" className="mt-3">正在处理…</p>}
      {error && <div className="mt-3 space-y-2"><p role="alert" className="text-red-700">{error}</p>
        {!user && <button type="button" onClick={begin} disabled={busy} className="rounded-md border border-slate-300 px-3 py-1.5">重新验证</button>}
      </div>}
    </dialog>
  </>;
}
