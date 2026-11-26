import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, CheckCircle2, ShieldCheck } from "lucide-react";
import { Turnstile, type TurnstileInstance } from "@marsidev/react-turnstile";
import { GoogleLogin, GoogleOAuthProvider } from "@react-oauth/google";
import { authRequest } from "./session.js";
import { LOGIN_ACTION, type LoginChallenge, type Session } from "./shared.js";

function GoogleGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#EA4335" d="M12 10.2v3.9h5.5c-.2 1.3-1.5 3.9-5.5 3.9-3.3 0-6-2.7-6-6s2.7-6 6-6c1.9 0 3.1.8 3.9 1.5l2.7-2.6C16.9 3.3 14.7 2.4 12 2.4 6.7 2.4 2.4 6.7 2.4 12S6.7 21.6 12 21.6c6.9 0 9.2-4.8 9.2-7.3 0-.5-.1-.9-.1-1.3H12z" />
      <path fill="#34A853" d="M3.5 7.4l3.2 2.3C7.6 7.6 9.6 6 12 6c1.9 0 3.1.8 3.9 1.5l2.7-2.6C16.9 3.3 14.7 2.4 12 2.4c-3.7 0-6.9 2.1-8.5 5z" />
      <path fill="#FBBC05" d="M12 21.6c2.6 0 4.8-.9 6.4-2.4l-3-2.5c-.8.6-1.9 1-3.4 1-2.6 0-4.8-1.7-5.6-4.1l-3.2 2.5c1.6 3.3 5 5.5 8.8 5.5z" />
      <path fill="#4285F4" d="M21.2 14.3c0-.5-.1-.9-.1-1.3H12v3.9h5.5c-.3 1.2-1 2.2-2.1 2.8l3 2.5c1.8-1.6 2.8-4.1 2.8-7.9z" />
    </svg>
  );
}

export function LoginForm({ theme, onSessionChange, onSuccess }: {
  theme: "dark" | "light";
  onSessionChange: (session: Session) => void;
  onSuccess: () => void;
}) {
  const widget = useRef<TurnstileInstance>(null);
  const attempt = useRef(0);
  const [stage, setStage] = useState<"idle" | "verify" | "google">("idle");
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
    return () => { ++attempt.current; };
  }, []);

  const handleStartGoogle = () => {
    setStage("verify");
    if (!challenge) {
      void begin();
    }
  };

  async function submit(credential?: string) {
    if (busy) return;
    if (!credential || !token) {
      setError("请重新完成人机验证和 Google 登录。");
      setStage("verify");
      return;
    }
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
      setStage("verify");
      setError(reason instanceof Error ? reason.message : "登录失败，请重试。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="lm-login-form">
      {stage === "idle" && (
        <button
          type="button"
          className="lm-google-entry-btn"
          onClick={handleStartGoogle}
        >
          <GoogleGlyph />
          <span>使用 Google 账号继续</span>
        </button>
      )}

      {stage === "verify" && (
        <div className="lm-login-panel">
          <div className="lm-login-panel-head">
            <span className="lm-login-panel-title">
              <ShieldCheck size={14} /> 人机安全验证
            </span>
            <button
              type="button"
              className="lm-login-back-btn"
              onClick={() => {
                setStage("idle");
                setError("");
              }}
            >
              <ArrowLeft size={12} /> 返回
            </button>
          </div>
          <p className="lm-login-panel-desc">通过验证后将自动进入 Google 账号登录。</p>
          <div className="lm-turnstile-box">
            {challenge ? (
              <Turnstile
                key={challenge.nonce}
                ref={widget}
                siteKey={challenge.turnstileSiteKey}
                options={{ action: LOGIN_ACTION, size: "flexible", theme }}
                onSuccess={(value) => {
                  setToken(value);
                  setError("");
                  setStage("google");
                }}
                onExpire={() => setToken("")}
                onTimeout={() => {
                  setToken("");
                  setError("验证已超时，请重试。");
                }}
                onError={() => {
                  setToken("");
                  setError("人机验证未完成，请重试。");
                }}
                scriptOptions={{ onError: () => setError("未能加载人机验证，请检查网络后重试。") }}
              />
            ) : (
              <span className="lm-muted">{error || "正在准备安全验证…"}</span>
            )}
          </div>
        </div>
      )}

      {stage === "google" && challenge && token && (
        <div className="lm-login-panel">
          <div className="lm-login-panel-head">
            <span className="lm-login-verified-pill">
              <CheckCircle2 size={13} /> 安全验证已通过
            </span>
            <button
              type="button"
              className="lm-login-back-btn"
              disabled={busy}
              onClick={() => {
                setStage("idle");
                setToken("");
                setError("");
              }}
            >
              <ArrowLeft size={12} /> 返回
            </button>
          </div>
          <p className="lm-login-panel-desc">点击下方按钮完成 Google 正式登录。</p>
          <div className="lm-google-wrap">
            {!busy ? (
              <GoogleOAuthProvider
                clientId={challenge.googleClientId}
                locale="zh_CN"
                onScriptLoadError={() => setError("未能加载 Google 登录，请检查网络后重试。")}
              >
                <GoogleLogin
                  nonce={challenge.nonce}
                  useOneTap
                  text="continue_with"
                  theme={theme === "dark" ? "filled_black" : "outline"}
                  width="320"
                  onSuccess={({ credential }) => void submit(credential)}
                  onError={() => setError("Google 登录未完成，请重试。")}
                />
              </GoogleOAuthProvider>
            ) : (
              <span className="lm-muted">正在登录…</span>
            )}
          </div>
        </div>
      )}

      {error && (
        <div className="lm-form-error" role="alert">
          <span>{error}</span>
          <button
            type="button"
            onClick={() => {
              setStage("verify");
              void begin();
            }}
            disabled={busy}
          >
            重试
          </button>
        </div>
      )}
    </div>
  );
}
