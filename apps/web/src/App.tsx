import { lazy, Suspense, useEffect, useState } from "react";
import { ArrowDown, ArrowRight, Boxes, CheckCircle2, GitBranch, Sparkles } from "lucide-react";
import { LoginForm } from "./auth/LoginForm.js";
import { useSession } from "./auth/session.js";
import type { Session } from "./auth/shared.js";
import { acceptInvite, previewInvite, type InvitePreview } from "./api.js";
import { useI18n } from "./i18n.js";
import { AppLink, navigate, useRoute } from "./navigation.js";
import { Brand, LanguageToggle, LoomindMark, ThemeToggle, type UiTheme } from "./ui.js";

const themeKey = "loomind-ui-theme";
const WorkspaceApp = lazy(() => import("./WorkspaceApp.js").then(({ WorkspaceApp }) => ({ default: WorkspaceApp })));
const TryPlaygroundPage = lazy(() => import("./TryPlaygroundPage.js").then(({ TryPlaygroundPage }) => ({ default: TryPlaygroundPage })));

function useTheme() {
  const [theme, setTheme] = useState<UiTheme>(() => {
    try { return localStorage.getItem(themeKey) === "light" ? "light" : "dark"; }
    catch { return "dark"; }
  });
  useEffect(() => {
    document.documentElement.dataset.uiTheme = theme;
    try { localStorage.setItem(themeKey, theme); } catch { /* The preference is optional. */ }
  }, [theme]);
  return { theme, toggle: () => setTheme((current) => current === "dark" ? "light" : "dark") };
}

function safeNext(search: string) {
  const next = new URLSearchParams(search).get("next");
  return next?.startsWith("/") && !next.startsWith("//") ? next : "/app";
}

export function App() {
  const route = useRoute();
  const { theme, toggle } = useTheme();
  const { session, changeSession, sessionError, refresh } = useSession();
  const { t } = useI18n();

  useEffect(() => {
    if (!session) return;
    if (session.user && (route.pathname === "/" || route.pathname === "/login")) navigate("/app", true);
    else if (!session.user && route.pathname.startsWith("/app")) navigate(`/login?next=${encodeURIComponent(route.pathname + route.search)}`, true);
  }, [session, route.pathname, route.search]);

  useEffect(() => {
    document.title = route.pathname.startsWith("/app/mindmaps/") ? t.meta.mapTitle
      : route.pathname.startsWith("/app") ? t.meta.workspaceTitle
      : route.pathname === "/try" ? t.meta.tryTitle
      : route.pathname === "/login" ? t.meta.loginTitle
      : t.meta.homeTitle;
  }, [route.pathname, t]);

  if (!session) return <div className="lm-theme lm-loading">{t.common.loadingApp}</div>;
  const notice = sessionError && <div className="lm-session-notice" role="alert">{sessionError} <button type="button" onClick={() => void refresh()}>{t.common.retry}</button></div>;
  if (route.pathname === "/try") return <div className="lm-theme" data-theme={theme}>
    {notice}<Suspense fallback={<div className="lm-loading">{t.common.loadingApp}</div>}>
      <TryPlaygroundPage session={session} theme={theme} toggleTheme={toggle}/>
    </Suspense>
  </div>;
  if (route.pathname.startsWith("/invite/")) return <div className="lm-theme" data-theme={theme}>
    {notice}<InvitePage key={route.pathname} token={route.pathname.slice("/invite/".length)} session={session} theme={theme} toggle={toggle}/>
  </div>;
  if (session.user) {
    if (route.pathname === "/" || route.pathname === "/login") return <div className="lm-theme lm-loading">{t.common.enteringWorkspace}</div>;
    if (route.pathname.startsWith("/app")) return <div className="lm-theme" data-theme={theme}>
      {notice}<Suspense fallback={<div className="lm-loading">{t.common.openingWorkspace}</div>}>
        <WorkspaceApp key={session.user.id} route={route} session={session} changeSession={changeSession} theme={theme} toggleTheme={toggle}/>
      </Suspense>
    </div>;
    return <div className="lm-theme" data-theme={theme}><NotFound to="/app" /></div>;
  }
  if (route.pathname.startsWith("/app")) return <div className="lm-theme lm-loading">{t.common.openingLogin}</div>;
  if (route.pathname === "/login") return <div className="lm-theme" data-theme={theme}>
    {notice}<LoginPage theme={theme} toggle={toggle} next={safeNext(route.search)} changeSession={changeSession}/>
  </div>;
  if (route.pathname === "/") return <div className="lm-theme" data-theme={theme}>{notice}<Landing theme={theme} toggle={toggle}/></div>;
  return <div className="lm-theme" data-theme={theme}><NotFound to="/" /></div>;
}

function PublicAtmosphere() {
  return (
    <div className="lm-public-atmosphere" aria-hidden="true">
      <div className="lm-ambient-glow" />
      <div className="lm-public-dotgrid" />
    </div>
  );
}

function Landing({ theme, toggle }: { theme: UiTheme; toggle: () => void }) {
  const { t, locale } = useI18n();
  const [activePreviewNode, setActivePreviewNode] = useState<"leftTop" | "leftBottom" | "rightTop" | "rightBottom" | null>(null);
  const featureIcons = [Sparkles, GitBranch, Boxes];
  const togglePreviewNode = (key: "leftTop" | "leftBottom" | "rightTop" | "rightBottom") => {
    setActivePreviewNode((cur) => (cur === key ? null : key));
  };
  return <div className="lm-public">
    <PublicAtmosphere />
    <header className="lm-site-header">
      <div className="lm-header-wide lm-site-header-inner">
        <Brand to="/"/>
        <nav aria-label={t.landing.navAria}>
          <AppLink href="/try">{t.landing.tryFreeCta}</AppLink>
          <AppLink href="/login" className="lm-primary-button lm-header-cta">{t.landing.startCta} <ArrowRight size={13}/></AppLink>
          <LanguageToggle/>
          <ThemeToggle theme={theme} toggle={toggle}/>
        </nav>
      </div>
    </header>
    <main className="lm-public-main">
      <section className="lm-hero lm-container">
        <div className="lm-hero-pill"><span className="lm-live-dot"/>{t.landing.heroPill}</div>
        <h1>{t.landing.heroTitleLine1}{locale === "en" ? " " : ""}<span>{t.landing.heroTitleLine2}</span></h1>
        <p className="lm-hero-subtitle">{t.landing.heroSubtitle}</p>
        <div className="lm-hero-actions">
          <AppLink href="/try" className="lm-primary-button"><Sparkles size={14}/> {t.landing.tryFreeCta}</AppLink>
          <AppLink href="/login" className="lm-secondary-button">{t.landing.heroPrimaryCta} <ArrowRight size={14}/></AppLink>
          <a href="#features" className="lm-secondary-button">{t.landing.heroSecondaryCta} <ArrowDown size={14}/></a>
        </div>
      </section>

      <section className="lm-preview lm-preview-wide" aria-label={t.landing.previewAria}>
        <div className="lm-preview-bar">
          <div className="lm-preview-bar-left">
            <LoomindMark size={18}/>
            <strong>{t.landing.previewMapTitle}</strong>
            <span className="lm-preview-chip">{t.landing.previewChatChip}</span>
          </div>
          <div className="lm-preview-segment">
            <span className="is-active">{t.landing.previewMapTab}</span>
            <span>{t.landing.previewOutlineTab}</span>
          </div>
          <div className="lm-preview-bar-right">
            <span>{t.landing.previewExport}</span>
            <span>{t.landing.previewFormat}</span>
          </div>
        </div>

        <div className="lm-preview-body">
          <aside className="lm-preview-chat">
            <div className="lm-preview-chat-head">
              <Sparkles size={12}/>
              <span>{t.landing.previewChatChip}</span>
            </div>
            <div className="lm-preview-chat-msgs">
              <div className="lm-preview-msg-user">{t.landing.previewUserMsg}</div>
              <div className="lm-preview-msg-ai">
                <p>{t.landing.previewAiMsg}</p>
                <div className="lm-preview-mutation">
                  <CheckCircle2 size={12}/>
                  <span>{t.landing.previewMutation}</span>
                </div>
              </div>
              {activePreviewNode && (
                <div className="lm-preview-node-note">
                  <strong>@ {t.landing.previewNodes[activePreviewNode]}</strong>
                  <p>{t.landing.previewNodeDetails[activePreviewNode]}</p>
                </div>
              )}
            </div>
            <div className="lm-preview-prompt">
              <span>{t.landing.previewPromptPlaceholder}</span>
              <b>{t.landing.previewSend}</b>
            </div>
          </aside>

          <div className="lm-preview-main">
            <div className="lm-preview-tree">
              <svg viewBox="0 0 760 320" preserveAspectRatio="none" aria-hidden="true">
                <path d="M380 160 C310 160 300 72 215 72 M380 160 C310 160 300 248 215 248 M380 160 C450 160 460 72 545 72 M380 160 C450 160 460 248 545 248"/>
              </svg>
              <button type="button" className="lm-preview-node center" onClick={() => setActivePreviewNode(null)}>{t.landing.previewNodes.center}</button>
              <button type="button" className={`lm-preview-node left top ${activePreviewNode === "leftTop" ? "is-active" : ""}`} onClick={() => togglePreviewNode("leftTop")}>{t.landing.previewNodes.leftTop}</button>
              <button type="button" className={`lm-preview-node left bottom ${activePreviewNode === "leftBottom" ? "is-active" : ""}`} onClick={() => togglePreviewNode("leftBottom")}>{t.landing.previewNodes.leftBottom}</button>
              <button type="button" className={`lm-preview-node right top ${activePreviewNode === "rightTop" ? "is-active" : ""}`} onClick={() => togglePreviewNode("rightTop")}>{t.landing.previewNodes.rightTop}</button>
              <button type="button" className={`lm-preview-node right bottom ${activePreviewNode === "rightBottom" ? "is-active" : ""}`} onClick={() => togglePreviewNode("rightBottom")}>{t.landing.previewNodes.rightBottom}</button>
            </div>
            <div className="lm-preview-dock" aria-hidden="true">
              <span>{t.landing.previewDock.subtopic}</span>
              <span>{t.landing.previewDock.sibling}</span>
              <span>{t.landing.previewDock.insert}</span>
              <span className="is-pill">{t.landing.previewDock.aiExpand}</span>
            </div>
          </div>
        </div>
      </section>

      <section id="features" className="lm-features lm-container">
        <div className="lm-section-heading">
          <span className="lm-eyebrow">{t.landing.featuresEyebrow}</span>
          <h2>{t.landing.featuresTitleLine1}<br/>{t.landing.featuresTitleLine2}</h2>
        </div>
        <div className="lm-feature-grid">
          {t.landing.features.map((feat, idx) => {
            const Icon = featureIcons[idx] ?? Sparkles;
            return (
              <article key={feat.num}>
                <span className="lm-feature-number">{feat.num}</span>
                <Icon size={18}/>
                <h3>{feat.title}</h3>
                <p>{feat.desc}</p>
              </article>
            );
          })}
        </div>
      </section>

      <section className="lm-closing lm-container">
        <div>
          <h2>{t.landing.closingTitle}</h2>
          <p className="lm-closing-sub">{t.landing.closingSub}</p>
        </div>
        <AppLink href="/login" className="lm-primary-button">{t.landing.closingCta} <ArrowRight size={15}/></AppLink>
      </section>
    </main>
  </div>;
}

function LoginPage({ theme, toggle, next, changeSession }: { theme: UiTheme; toggle: () => void; next: string; changeSession: (session: Session) => void }) {
  const { t } = useI18n();
  return <div className="lm-public lm-login-page">
    <PublicAtmosphere />
    <header className="lm-site-header">
      <div className="lm-header-wide lm-site-header-inner">
        <Brand to="/"/>
        <div className="lm-header-actions"><AppLink href="/">{t.login.backHome}</AppLink><LanguageToggle/><ThemeToggle theme={theme} toggle={toggle}/></div>
      </div>
    </header>
    <main className="lm-login-main lm-public-main"><div className="lm-login-card"><div className="lm-login-symbol"><LoomindMark size={38}/></div>
      <p className="lm-eyebrow">LOOMIND</p><h1>{t.login.title}</h1><p className="lm-login-intro">{t.login.intro}</p>
      <LoginForm theme={theme} onSessionChange={changeSession} onSuccess={() => navigate(next, true)}/>
    </div></main>
  </div>;
}

function InvitePage({ token, session, theme, toggle }: { token: string; session: Session; theme: UiTheme; toggle: () => void }) {
  const { t } = useI18n();
  const [invite, setInvite] = useState<InvitePreview | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    void previewInvite(token).then((value) => { if (active) setInvite(value); }).catch((reason) => {
      if (active) setError(reason instanceof Error ? reason.message : t.invite.unavailable);
    });
    return () => { active = false; };
  }, [token, t.invite.unavailable]);
  async function accept() {
    setBusy(true);
    setError("");
    try {
      const result = await acceptInvite(token);
      navigate(result.type === "mindmap" ? `/app/mindmaps/${result.id}` : `/app?workspace=${encodeURIComponent(result.id)}`, true);
    } catch (reason) { setError(reason instanceof Error ? reason.message : t.invite.joinFailed); }
    finally { setBusy(false); }
  }
  return <div className="lm-public lm-login-page">
    <PublicAtmosphere />
    <header className="lm-site-header">
      <div className="lm-header-wide lm-site-header-inner">
        <Brand to={session.user ? "/app" : "/"}/>
        <div className="lm-header-actions"><LanguageToggle/><ThemeToggle theme={theme} toggle={toggle}/></div>
      </div>
    </header>
    <main className="lm-login-main lm-public-main"><div className="lm-login-card lm-invite-card"><div className="lm-login-symbol"><Boxes size={22}/></div><p className="lm-eyebrow">{t.invite.eyebrow}</p>
      <h1>{invite ? (invite.type === "workspace" ? t.invite.joinWorkspace : t.invite.joinMap) : t.invite.defaultTitle}</h1>
      {invite && <div className="lm-invite-detail"><strong>{invite.name}</strong><span>{invite.role === "editor" ? t.common.canEdit : t.common.canView} · {t.invite.validSevenDays}</span></div>}
      {error && <p className="lm-form-error" role="alert">{error}</p>}
      {!invite && !error && <p className="lm-muted">{t.invite.loading}</p>}
      {invite && (session.user ? <button type="button" className="lm-primary-button" disabled={busy} onClick={() => void accept()}>{busy ? t.invite.joining : t.invite.accept}<ArrowRight size={16}/></button>
        : <AppLink href={`/login?next=${encodeURIComponent(`/invite/${token}`)}`} className="lm-primary-button">{t.invite.loginToJoin} <ArrowRight size={16}/></AppLink>)}
    </div></main>
  </div>;
}

function NotFound({ to }: { to: string }) {
  const { t } = useI18n();
  return <div className="lm-not-found"><span className="lm-eyebrow">{t.notFound.eyebrow}</span><h1>{t.notFound.pageTitle}</h1><AppLink href={to} className="lm-primary-button">{t.notFound.backToLoomind} <ArrowRight size={16}/></AppLink></div>;
}
