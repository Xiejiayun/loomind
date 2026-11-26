import { lazy, Suspense, useEffect, useState } from "react";
import { ArrowRight, ArrowUpRight, Boxes, GitBranch, Sparkles } from "lucide-react";
import { LoginForm } from "./auth/LoginForm.js";
import { useSession } from "./auth/session.js";
import type { Session } from "./auth/shared.js";
import { acceptInvite, previewInvite, type InvitePreview } from "./api.js";
import { AppLink, navigate, useRoute } from "./navigation.js";
import { Brand, LoomindMark, ThemeToggle, type UiTheme } from "./ui.js";

const themeKey = "loomind-ui-theme";
const WorkspaceApp = lazy(() => import("./WorkspaceApp.js").then(({ WorkspaceApp }) => ({ default: WorkspaceApp })));
const GuestEditor = lazy(() => import("./GuestEditor.js").then(({ GuestEditor }) => ({ default: GuestEditor })));

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

  useEffect(() => {
    if (!session) return;
    if (session.user && (route.pathname === "/" || route.pathname === "/login")) navigate("/app", true);
    else if (!session.user && route.pathname.startsWith("/app")) navigate(`/login?next=${encodeURIComponent(route.pathname + route.search)}`, true);
  }, [session, route.pathname, route.search]);

  useEffect(() => {
    document.title = route.pathname.startsWith("/app/mindmaps/") ? "导图 — Loomind"
      : route.pathname.startsWith("/app") ? "工作区 — Loomind"
      : route.pathname === "/login" ? "登录 — Loomind"
      : "Loomind — 把想法变成清晰的导图";
  }, [route.pathname]);

  if (!session) return <div className="lm-theme lm-loading">正在加载 Loomind…</div>;
  const notice = sessionError && <div className="lm-session-notice" role="alert">{sessionError} <button type="button" onClick={() => void refresh()}>重试</button></div>;
  if (route.pathname.startsWith("/invite/")) return <div className="lm-theme" data-theme={theme}>
    {notice}<InvitePage key={route.pathname} token={route.pathname.slice("/invite/".length)} session={session} theme={theme} toggle={toggle}/>
  </div>;
  if (session.user) {
    if (route.pathname === "/" || route.pathname === "/login") return <div className="lm-theme lm-loading">正在进入工作区…</div>;
    if (route.pathname.startsWith("/app")) return <div className="lm-theme" data-theme={theme}>
      {notice}<Suspense fallback={<div className="lm-loading">正在打开工作区…</div>}>
        <WorkspaceApp key={session.user.id} route={route} session={session} changeSession={changeSession} theme={theme} toggleTheme={toggle}/>
      </Suspense>
    </div>;
    return <div className="lm-theme" data-theme={theme}><NotFound to="/app" /></div>;
  }
  if (route.pathname.startsWith("/app")) return <div className="lm-theme lm-loading">正在打开登录页面…</div>;
  if (route.pathname === "/try") return <div className="lm-theme" data-theme={theme}>{notice}<Suspense fallback={<div className="lm-loading">正在打开编辑器…</div>}><GuestEditor theme={theme} toggleTheme={toggle}/></Suspense></div>;
  if (route.pathname === "/login") return <div className="lm-theme" data-theme={theme}>
    {notice}<LoginPage theme={theme} toggle={toggle} next={safeNext(route.search)} changeSession={changeSession}/>
  </div>;
  if (route.pathname === "/") return <div className="lm-theme" data-theme={theme}>{notice}<Landing theme={theme} toggle={toggle}/></div>;
  return <div className="lm-theme" data-theme={theme}><NotFound to="/" /></div>;
}

function Landing({ theme, toggle }: { theme: UiTheme; toggle: () => void }) {
  return <div className="lm-public">
    <header className="lm-site-header lm-container"><Brand to="/"/><nav aria-label="主页导航">
      <a href="#features">产品能力</a><AppLink href="/login">登录</AppLink><ThemeToggle theme={theme} toggle={toggle}/>
    </nav></header>
    <main>
      <section className="lm-hero lm-container">
        <p className="lm-eyebrow"><span className="lm-live-dot"/> THINK CLEARLY · BUILD TOGETHER</p>
        <h1>把想法，变成<br/><span>清晰的思路。</span></h1>
        <p className="lm-hero-subtitle">从一个主题或已有大纲开始，整理成可以继续编辑的导图。一个账号管理多张作品，也能与团队分享。</p>
        <div className="lm-hero-actions"><AppLink href="/login" className="lm-primary-button">开始构建 <ArrowRight size={17}/></AppLink>
          <AppLink href="/try" className="lm-secondary-button">试用编辑器 <ArrowUpRight size={16}/></AppLink></div>
        <div className="lm-hero-signals"><span>IDEA FIRST</span><span>OUTLINE READY</span><span>MANY MINDMAPS</span><span>SHAREABLE WORKSPACES</span></div>
      </section>
      <section className="lm-preview lm-container" aria-label="Loomind 工作区预览">
        <div className="lm-preview-bar"><LoomindMark size={18}/><strong>Loomind</strong><span>/</span><span>workspace</span><span className="lm-preview-status"><span className="lm-live-dot"/> READY</span></div>
        <div className="lm-preview-body"><aside><span className="lm-preview-label">RECENT</span><span>◇ 产品发布计划</span><span>◇ 年度学习目标</span><span>◇ 系统架构</span></aside>
          <div className="lm-preview-main"><span className="lm-preview-label">WORKSPACE / 01</span><h2>今天想梳理什么？</h2>
            <div className="lm-preview-prompt"><span>新产品从调研到发布的计划…</span><b>创建导图 ↗</b></div>
            <div className="lm-preview-tree"><svg viewBox="0 0 760 220" preserveAspectRatio="none" aria-hidden="true"><path d="M380 110 C320 110 310 45 235 45 M380 110 C320 110 310 175 235 175 M380 110 C445 110 450 45 525 45 M380 110 C445 110 450 175 525 175"/></svg>
              <span className="lm-preview-node center">产品发布计划</span><span className="lm-preview-node left top">用户研究</span><span className="lm-preview-node left bottom">产品定义</span><span className="lm-preview-node right top">上线准备</span><span className="lm-preview-node right bottom">复盘指标</span>
            </div>
          </div></div>
        <div className="lm-preview-foot"><span>LOOMIND / WORKSPACE</span><span>THINK IN SYSTEMS</span></div>
      </section>
      <section id="features" className="lm-features lm-container"><div className="lm-section-heading"><span className="lm-eyebrow">ONE PLACE TO THINK</span><h2>从模糊到清楚，<br/>每一步都有位置。</h2></div>
        <div className="lm-feature-grid"><article><span className="lm-feature-number">01 / THINK</span><Sparkles size={20}/><h3>从想法开始</h3><p>先用一句话创建导图，再继续编辑。对话式 AI 共建将在后续接入。</p></article>
          <article><span className="lm-feature-number">02 / STRUCTURE</span><GitBranch size={20}/><h3>放入已有大纲</h3><p>粘贴 Markdown、列表或缩进文本，保留层级，并选择适合的布局模板。</p></article>
          <article><span className="lm-feature-number">03 / ORGANIZE</span><Boxes size={20}/><h3>多图与共享空间</h3><p>每个账号管理多张独立导图，也能邀请他人进入工作区或分享单张导图。</p></article></div>
      </section>
      <section className="lm-closing lm-container"><div><span className="lm-eyebrow">READY WHEN YOU ARE</span><h2>开始整理你的下一件事。</h2></div><AppLink href="/login" className="lm-primary-button">进入 Loomind <ArrowRight size={17}/></AppLink></section>
    </main>
    <footer className="lm-public-footer lm-container"><span>© Loomind</span><span>MAKE IDEAS VISIBLE</span></footer>
  </div>;
}

function LoginPage({ theme, toggle, next, changeSession }: { theme: UiTheme; toggle: () => void; next: string; changeSession: (session: Session) => void }) {
  return <div className="lm-public lm-login-page"><header className="lm-site-header lm-container"><Brand to="/"/><div className="lm-header-actions"><AppLink href="/">返回首页</AppLink><ThemeToggle theme={theme} toggle={toggle}/></div></header>
    <main className="lm-login-main"><div className="lm-login-card"><div className="lm-login-symbol"><LoomindMark size={38}/></div>
      <p className="lm-eyebrow">LOOMIND</p><h1>登录，继续思考。</h1><p className="lm-login-intro">使用 Google 账号安全登录，你的导图将自动同步到云端工作区。</p>
      <LoginForm theme={theme} onSessionChange={changeSession} onSuccess={() => navigate(next, true)}/>
      <div className="lm-login-footer">想先看看编辑器？<AppLink href="/try">以游客身份试用 <ArrowUpRight size={14}/></AppLink></div>
    </div></main>
  </div>;
}

function InvitePage({ token, session, theme, toggle }: { token: string; session: Session; theme: UiTheme; toggle: () => void }) {
  const [invite, setInvite] = useState<InvitePreview | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    void previewInvite(token).then((value) => { if (active) setInvite(value); }).catch((reason) => {
      if (active) setError(reason instanceof Error ? reason.message : "邀请链接不可用。");
    });
    return () => { active = false; };
  }, [token]);
  async function accept() {
    setBusy(true);
    setError("");
    try {
      const result = await acceptInvite(token);
      navigate(result.type === "mindmap" ? `/app/mindmaps/${result.id}` : `/app?workspace=${encodeURIComponent(result.id)}`, true);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "无法加入，请重试。"); }
    finally { setBusy(false); }
  }
  return <div className="lm-public lm-login-page"><header className="lm-site-header lm-container"><Brand to={session.user ? "/app" : "/"}/><ThemeToggle theme={theme} toggle={toggle}/></header>
    <main className="lm-login-main"><div className="lm-login-card lm-invite-card"><div className="lm-login-symbol"><Boxes size={22}/></div><p className="lm-eyebrow">SHARED WITH YOU</p>
      <h1>{invite ? `加入${invite.type === "workspace" ? "工作区" : "导图"}` : "邀请链接"}</h1>
      {invite && <div className="lm-invite-detail"><strong>{invite.name}</strong><span>{invite.role === "editor" ? "可编辑" : "可查看"} · 7 天有效邀请</span></div>}
      {error && <p className="lm-form-error" role="alert">{error}</p>}
      {!invite && !error && <p className="lm-muted">正在读取邀请…</p>}
      {invite && (session.user ? <button type="button" className="lm-primary-button" disabled={busy} onClick={() => void accept()}>{busy ? "正在加入…" : "接受邀请"}<ArrowRight size={16}/></button>
        : <AppLink href={`/login?next=${encodeURIComponent(`/invite/${token}`)}`} className="lm-primary-button">登录后加入 <ArrowRight size={16}/></AppLink>)}
    </div></main>
  </div>;
}

function NotFound({ to }: { to: string }) {
  return <div className="lm-not-found"><span className="lm-eyebrow">404 / NOT FOUND</span><h1>找不到这个页面</h1><AppLink href={to} className="lm-primary-button">返回 Loomind <ArrowRight size={16}/></AppLink></div>;
}
