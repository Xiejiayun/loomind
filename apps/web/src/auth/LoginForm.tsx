import { useCallback, useEffect, useRef, useState } from "react";
import { Turnstile, type TurnstileInstance } from "@marsidev/react-turnstile";
import { GoogleLogin, GoogleOAuthProvider } from "@react-oauth/google";
import { authRequest } from "./session.js";
import { LOGIN_ACTION, type LoginChallenge, type Session } from "./shared.js";

export function LoginForm({ theme, onSessionChange, onSuccess }: {
  theme: "dark" | "light";
  onSessionChange: (session: Session) => void;
  onSuccess: () => void;
}) {
  const widget = useRef<TurnstileInstance>(null);
  const attempt = useRef(0);
  const [challenge, setChallenge] = useState<LoginChallenge | null>(null);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const begin = useCallback(async () => {
    const current = ++attempt.current;
    setError("");
    setChallenge(null);
    setToken("");
    try {
      const next = await authRequest<LoginChallenge>("challenge");
      if (current === attempt.current) setChallenge(next);
    } catch (reason) {
      if (current === attempt.current) setError(reason instanceof Error ? reason.message : "无法准备登录。");
    }
  }, []);

  useEffect(() => {
    void begin();
    return () => { ++attempt.current; };
  }, [begin]);

  async function submit(credential?: string) {
    if (busy) return;
    if (!credential || !token) { setError("请重新完成人机验证和 Google 登录。"); return; }
    setBusy(true);
    setError("");
    try {
      const session = await authRequest<Session>("google", "POST", { credential, turnstileToken: token });
      onSessionChange(session);
      onSuccess();
    } catch (reason) {
      widget.current?.reset();
      setToken("");
      setChallenge(null);
      setError(reason instanceof Error ? reason.message : "登录失败，请重试。");
    } finally {
      setBusy(false);
    }
  }

  return <div className="lm-login-form">
    <div className="lm-login-step"><span>01</span><strong>人机验证</strong></div>
    <div className="lm-turnstile-box">
      {challenge ? <Turnstile key={challenge.nonce} ref={widget} siteKey={challenge.turnstileSiteKey}
        options={{ action: LOGIN_ACTION, size: "flexible", theme }}
        onSuccess={(value) => { setToken(value); setError(""); }}
        onExpire={() => setToken("")}
        onTimeout={() => { setToken(""); setError("验证已超时，请重试。"); }}
        onError={() => { setToken(""); setError("人机验证未完成，请重试。"); }}
        scriptOptions={{ onError: () => setError("未能加载人机验证，请检查网络后重试。") }} />
        : <span className="lm-muted">{error || "正在准备验证…"}</span>}
    </div>
    <div className="lm-login-step"><span>02</span><strong>Google 登录</strong></div>
    <div className="lm-google-wrap">
      {challenge && token && !busy ? <GoogleOAuthProvider clientId={challenge.googleClientId} locale="zh_CN"
        onScriptLoadError={() => setError("未能加载 Google 登录，请检查网络后重试。") }>
        <GoogleLogin nonce={challenge.nonce} text="continue_with" theme={theme === "dark" ? "filled_black" : "outline"}
          width="320" onSuccess={({ credential }) => void submit(credential)}
          onError={() => setError("Google 登录未完成，请重试。")}/>
      </GoogleOAuthProvider> : <span className="lm-muted">{busy ? "正在登录…" : "完成人机验证后继续"}</span>}
    </div>
    {error && <div className="lm-form-error" role="alert"><span>{error}</span><button type="button" onClick={() => void begin()} disabled={busy}>重新验证</button></div>}
  </div>;
}
