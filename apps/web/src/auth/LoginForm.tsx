import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, CheckCircle2, ShieldCheck } from "lucide-react";
import { Turnstile, type TurnstileInstance } from "@marsidev/react-turnstile";
import { GoogleLogin, GoogleOAuthProvider } from "@react-oauth/google";
import { useI18n } from "../i18n.js";
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
  const { locale, t } = useI18n();
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
      if (current === attempt.current) setError(reason instanceof Error ? reason.message : t.login.prepareError);
    }
  }, [t.login.prepareError]);

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
      setError(t.login.reverifyError);
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
      setError(reason instanceof Error ? reason.message : t.login.loginFailed);
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
          <span>{t.login.continueWithGoogle}</span>
        </button>
      )}

      {stage === "verify" && (
        <div className="lm-login-panel">
          <div className="lm-login-panel-head">
            <span className="lm-login-panel-title">
              <ShieldCheck size={14} /> {t.login.verifyTitle}
            </span>
            <button
              type="button"
              className="lm-login-back-btn"
              onClick={() => {
                setStage("idle");
                setError("");
              }}
            >
              <ArrowLeft size={12} /> {t.common.back}
            </button>
          </div>
          <p className="lm-login-panel-desc">{t.login.verifyDesc}</p>
          <div className="lm-turnstile-box">
            {challenge ? (
              <Turnstile
                key={challenge.nonce}
                ref={widget}
                siteKey={challenge.turnstileSiteKey}
                options={{ action: LOGIN_ACTION, size: "flexible", theme, language: locale === "zh" ? "zh-cn" : "en" }}
                onSuccess={(value) => {
                  setToken(value);
                  setError("");
                  setStage("google");
                }}
                onExpire={() => setToken("")}
                onTimeout={() => {
                  setToken("");
                  setError(t.login.turnstileTimeout);
                }}
                onError={() => {
                  setToken("");
                  setError(t.login.turnstileError);
                }}
                scriptOptions={{ onError: () => setError(t.login.turnstileScriptError) }}
              />
            ) : (
              <span className="lm-muted">{error || t.login.preparingVerify}</span>
            )}
          </div>
        </div>
      )}

      {stage === "google" && challenge && token && (
        <div className="lm-login-panel">
          <div className="lm-login-panel-head">
            <span className="lm-login-verified-pill">
              <CheckCircle2 size={13} /> {t.login.verifiedPill}
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
              <ArrowLeft size={12} /> {t.common.back}
            </button>
          </div>
          <p className="lm-login-panel-desc">{t.login.googleDesc}</p>
          <div className="lm-google-wrap">
            {!busy ? (
              <GoogleOAuthProvider
                clientId={challenge.googleClientId}
                locale={locale === "zh" ? "zh_CN" : "en"}
                onScriptLoadError={() => setError(t.login.googleScriptError)}
              >
                <GoogleLogin
                  nonce={challenge.nonce}
                  useOneTap
                  text="continue_with"
                  theme={theme === "dark" ? "filled_black" : "outline"}
                  width="320"
                  onSuccess={({ credential }) => void submit(credential)}
                  onError={() => setError(t.login.googleError)}
                />
              </GoogleOAuthProvider>
            ) : (
              <span className="lm-muted">{t.login.signingIn}</span>
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
            {t.common.retry}
          </button>
        </div>
      )}
    </div>
  );
}
