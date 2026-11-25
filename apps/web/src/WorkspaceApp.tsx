import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { ArrowRight, ArrowUpRight, ChevronDown, Command, FolderOpen, Menu, Plus, Search, Share2, X } from "lucide-react";
import type { MindmapDocument } from "@mindmap/core";
import { authRequest } from "./auth/session.js";
import type { Session } from "./auth/shared.js";
import { createWorkspace, listWorkspaces, moveMindmap, type WorkspaceSummary } from "./api.js";
import { CreateView } from "./CreateView.js";
import { deleteCloud, listCloud } from "./drafts/cloud.js";
import { mapTitle, MAP_ID, type MindmapSummary } from "./drafts/shared.js";
import { LibraryView } from "./LibraryView.js";
import { AppLink, navigate } from "./navigation.js";
import { deleteLocal, listLocalMaps, loadLocal, saveLocal } from "./persistence.js";
import { ShareDialog, type ShareTarget } from "./ShareDialog.js";
import { Brand, ThemeToggle, type UiTheme } from "./ui.js";

const EditorWorkspace = lazy(() => import("./EditorWorkspace.js").then(({ EditorWorkspace }) => ({ default: EditorWorkspace })));

interface Props {
  route: { pathname: string; search: string };
  session: Session;
  changeSession: (session: Session) => void;
  theme: UiTheme;
  toggleTheme: () => void;
}

function errorText(reason: unknown, fallback: string) {
  return reason instanceof Error ? reason.message : fallback;
}

function sortMaps(items: MindmapSummary[]) {
  return [...items].sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
}

export function WorkspaceApp({ route, session, changeSession, theme, toggleTheme }: Props) {
  const owner = session.user!.id;
  const [maps, setMaps] = useState<MindmapSummary[]>([]);
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState("");
  const [actionError, setActionError] = useState("");
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(() => {
    const invited = new URLSearchParams(route.search).get("workspace");
    if (invited && MAP_ID.test(invited)) return invited;
    try { return localStorage.getItem(`loomind:space:${owner}`) || null; }
    catch { return null; }
  });
  const [prompt, setPrompt] = useState("");
  const [pendingPrompt, setPendingPrompt] = useState("");
  const [shareTarget, setShareTarget] = useState<ShareTarget | null>(null);
  const [workspaceDialogOpen, setWorkspaceDialogOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const picker = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      let local: MindmapSummary[] = [];
      const failures: string[] = [];
      try {
        local = await listLocalMaps(owner);
        const legacy = await loadLocal(owner);
        if (legacy && !local.length) {
          const id = crypto.randomUUID();
          await saveLocal(owner, { ...legacy, workspaceId: null, access: "owner" }, id);
          local = [{ id, title: mapTitle(legacy.document), updatedAt: "", workspaceId: null, access: "owner" }];
        }
      } catch (reason) { failures.push(errorText(reason, "无法读取本机导图。")); }
      let remote: MindmapSummary[] | null = null;
      try { remote = await listCloud(owner); }
      catch (reason) { failures.push(errorText(reason, "无法读取云端导图。")); }
      let spaces: WorkspaceSummary[] = [];
      try { spaces = await listWorkspaces(); }
      catch (reason) { failures.push(errorText(reason, "无法读取工作区。")); }
      if (!active) return;
      const merged = remote ? [...remote, ...local.filter((item) => !remote!.some((cloud) => cloud.id === item.id))] : local;
      setMaps(sortMaps(merged));
      setWorkspaces(spaces);
      setActiveWorkspaceId((current) => current && spaces.some((space) => space.id === current) ? current : null);
      setListError(failures.join(" "));
      setLoading(false);
    })();
    return () => { active = false; };
  }, [owner]);

  useEffect(() => {
    try { localStorage.setItem(`loomind:space:${owner}`, activeWorkspaceId ?? ""); } catch { /* Optional preference. */ }
  }, [owner, activeWorkspaceId]);

  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        navigate("/app/library");
        window.setTimeout(() => document.getElementById("lm-library-search")?.focus(), 0);
      } else if (event.key.toLowerCase() === "n" && !event.ctrlKey && !event.metaKey && !event.altKey &&
        !(event.target instanceof HTMLElement && (event.target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName)))) {
        event.preventDefault();
        navigate("/app/create");
      }
    };
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, []);

  const activeSpace = workspaces.find((space) => space.id === activeWorkspaceId) ?? null;
  const recent = useMemo(() => sortMaps(maps.filter((map) => map.workspaceId === activeWorkspaceId)).slice(0, 6), [maps, activeWorkspaceId]);

  async function createMap(document: MindmapDocument, workspaceId: string | null) {
    const id = crypto.randomUUID();
    await saveLocal(owner, { document, revision: 0, dirty: true, workspaceId, access: "owner" }, id);
    setMaps((current) => [{ id, title: mapTitle(document), updatedAt: new Date().toISOString(), workspaceId, access: "owner" }, ...current]);
    setActiveWorkspaceId(workspaceId);
    setPendingPrompt("");
    navigate(`/app/mindmaps/${id}`);
  }

  async function createSpace(name: string) {
    const space = await createWorkspace(name);
    setWorkspaces((current) => [...current, space]);
    setActiveWorkspaceId(space.id);
    setActionError("");
  }

  async function moveMap(map: MindmapSummary, workspaceId: string) {
    await moveMindmap(workspaceId, map.id);
    const local = await loadLocal(owner, map.id);
    if (local) await saveLocal(owner, { ...local, workspaceId }, map.id);
    setMaps((current) => current.map((item) => item.id === map.id ? { ...item, workspaceId } : item));
  }

  async function deleteMap(map: MindmapSummary) {
    try { await deleteCloud(owner, map.id); }
    catch (reason) {
      if (!(reason instanceof Error && "status" in reason && reason.status === 404)) throw reason;
    }
    await deleteLocal(owner, map.id);
    setMaps((current) => current.filter((item) => item.id !== map.id));
  }

  const rename = useCallback((id: string, title: string) => {
    setMaps((current) => current.map((item) => item.id === id ? { ...item, title, updatedAt: new Date().toISOString() } : item));
  }, []);

  async function logout() {
    try {
      const next = await authRequest<Session>("logout");
      changeSession(next);
      navigate("/", true);
    } catch (reason) { setActionError(errorText(reason, "退出失败，请重试。")); }
  }

  const editorMatch = /^\/app\/mindmaps\/([^/]+)$/.exec(route.pathname);
  const mapId = editorMatch?.[1] ?? null;
  if (loading) return <div className="lm-loading">正在打开工作区…</div>;
  if (mapId) {
    const map = MAP_ID.test(mapId) ? maps.find((item) => item.id === mapId) : undefined;
    if (!map) return <div className="lm-not-found"><span className="lm-eyebrow">MINDMAP / NOT FOUND</span><h1>找不到这张导图</h1><p>它可能已被删除，或者你没有访问权限。</p><AppLink href="/app/library" className="lm-primary-button">返回导图库 <ArrowRight size={16}/></AppLink></div>;
    return <><Suspense fallback={<div className="lm-loading">正在打开导图…</div>}>
      <EditorWorkspace key={map.id} map={map} owner={owner} session={session} changeSession={changeSession} onRename={rename}
        onShare={() => setShareTarget({ type: "mindmap", id: map.id, name: map.title })} listError={listError}/>
    </Suspense>
      <ShareDialog target={shareTarget} onClose={() => setShareTarget(null)}/></>;
  }

  const isLibrary = route.pathname === "/app/library";
  const isCreate = route.pathname === "/app/create";
  const createMode = new URLSearchParams(route.search).get("mode") === "outline" ? "outline" : "idea";
  const crumb = isLibrary ? "全部导图" : isCreate ? "新建导图" : "工作区";
  const chooseSpace = (id: string | null) => {
    setActiveWorkspaceId(id);
    picker.current && (picker.current.open = false);
    setMobileOpen(false);
    navigate("/app");
  };

  return <div className="lm-app-shell">
    <aside className={`lm-sidebar ${mobileOpen ? "is-open" : ""}`} aria-label="工作区侧栏">
      <div className="lm-sidebar-brand"><Brand to="/app"/><button type="button" className="lm-mobile-close" aria-label="关闭侧栏" onClick={() => setMobileOpen(false)}><X size={18}/></button></div>
      <div className="lm-sidebar-top">
        <details ref={picker} className="lm-space-picker"><summary aria-label="选择工作区"><span className="lm-space-avatar">{(activeSpace?.name ?? "L").slice(0, 1).toUpperCase()}</span><strong>{activeSpace?.name ?? "我的导图"}</strong><ChevronDown size={15}/></summary>
          <div className="lm-space-menu"><span className="lm-eyebrow">WORKSPACES</span>
            <button type="button" aria-current={!activeWorkspaceId ? "page" : undefined} onClick={() => chooseSpace(null)}>我的导图</button>
            {workspaces.map((space) => <button key={space.id} type="button" aria-current={activeWorkspaceId === space.id ? "page" : undefined}
              onClick={() => chooseSpace(space.id)}>{space.name}<small>{space.role === "owner" ? "所有者" : space.role === "editor" ? "编辑" : "查看"}</small></button>)}
            <div className="lm-space-menu-actions"><button type="button" onClick={() => { picker.current && (picker.current.open = false); setWorkspaceDialogOpen(true); }}><Plus size={14}/> 新建工作区</button>
              {activeSpace?.role === "owner" && <button type="button" onClick={() => { picker.current && (picker.current.open = false); setShareTarget({ type: "workspace", id: activeSpace.id, name: activeSpace.name }); }}><Share2 size={14}/> 共享此工作区</button>}</div>
          </div></details>
        <AppLink href="/app/create" className="lm-new-map-button" onClick={() => setMobileOpen(false)}><Plus size={17}/> 新建导图 <kbd>N</kbd></AppLink>
      </div>
      <nav className="lm-recent-nav" aria-label="最近导图"><div className="lm-sidebar-section-title"><span>RECENT</span><AppLink href="/app/library" aria-label="查看全部导图"><ArrowUpRight size={14}/></AppLink></div>
        {recent.map((map) => <AppLink key={map.id} href={`/app/mindmaps/${map.id}`} className="lm-recent-link" onClick={() => setMobileOpen(false)}><span aria-hidden="true">◇</span><span>{map.title}</span></AppLink>)}
        {!recent.length && <p className="lm-sidebar-empty">这里会显示最近编辑的导图。</p>}
      </nav>
      <div className="lm-sidebar-bottom"><div className="lm-sidebar-account"><span className="lm-account-avatar">{session.user!.email.slice(0, 1).toUpperCase()}</span><div><strong>{session.user!.email.split("@")[0]}</strong><small>{session.user!.email}</small></div></div>
        <button type="button" className="lm-sidebar-logout" onClick={() => void logout()}>退出登录</button></div>
    </aside>
    {mobileOpen && <button type="button" className="lm-sidebar-scrim" aria-label="关闭侧栏" onClick={() => setMobileOpen(false)}/>}
    <div className="lm-app-column"><header className="lm-app-topbar"><button type="button" className="lm-mobile-menu" aria-label="打开侧栏" onClick={() => setMobileOpen(true)}><Menu size={19}/></button>
      <div className="lm-breadcrumb"><AppLink href="/app">loomind</AppLink><span>/</span><strong>{crumb}</strong></div>
      <div className="lm-topbar-actions"><button type="button" className="lm-search-button" onClick={() => { navigate("/app/library"); window.setTimeout(() => document.getElementById("lm-library-search")?.focus(), 0); }}><Search size={15}/><span>搜索导图</span><kbd><Command size={11}/> K</kbd></button>
        <AppLink href="/app/library" className="lm-topbar-library"><FolderOpen size={16}/> 全部导图</AppLink><ThemeToggle theme={theme} toggle={toggleTheme}/></div>
    </header>
      <main className="lm-main-area">
        {(listError || actionError) && <div className="lm-app-alert" role="alert">{actionError || listError}<button type="button" onClick={() => { setActionError(""); setListError(""); }}>关闭</button></div>}
        {isLibrary ? <LibraryView maps={maps} workspaces={workspaces} onShare={(map) => setShareTarget({ type: "mindmap", id: map.id, name: map.title })}
          onMove={moveMap} onDelete={deleteMap}/>
          : isCreate ? <CreateView mode={createMode} initialPrompt={pendingPrompt} activeWorkspaceId={activeWorkspaceId} workspaces={workspaces}
            onModeChange={(mode) => navigate(`/app/create${mode === "outline" ? "?mode=outline" : ""}`, true)} onCreate={createMap}/>
            : route.pathname === "/app" ? <HomeView activeName={activeSpace?.name ?? "我的导图"} prompt={prompt} onPrompt={setPrompt}
              onStart={() => { setPendingPrompt(prompt); navigate("/app/create"); }} onOutline={() => navigate("/app/create?mode=outline")}/>
              : <div className="lm-content lm-not-found-inline"><h1>找不到这个页面</h1><AppLink href="/app" className="lm-primary-button">返回工作区 <ArrowRight size={16}/></AppLink></div>}
      </main>
    </div>
    <ShareDialog target={shareTarget} onClose={() => setShareTarget(null)}/>
    <CreateWorkspaceDialog open={workspaceDialogOpen} onClose={() => setWorkspaceDialogOpen(false)} onCreate={createSpace}/>
  </div>;
}

function HomeView({ activeName, prompt, onPrompt, onStart, onOutline }: {
  activeName: string;
  prompt: string;
  onPrompt: (value: string) => void;
  onStart: () => void;
  onOutline: () => void;
}) {
  return <div className="lm-content lm-home"><div className="lm-home-heading"><p className="lm-eyebrow"><span className="lm-live-dot"/> {activeName.toUpperCase()} / READY</p>
    <h1>今天想梳理什么？</h1><p>从一个主题开始，Loomind 会给你的想法一个可继续编辑的空间。</p></div>
    <section className="lm-compose-panel" aria-labelledby="lm-compose-title"><div className="lm-panel-heading"><span className="lm-eyebrow">NEW MINDMAP / 01</span><span className="lm-badge">AI CO-CREATION · SOON</span></div>
      <h2 id="lm-compose-title">从一个想法开始</h2><p>写下你要理清的问题或目标。对话式 AI 共建将在后续开放；现在可以先创建导图，再用现有编辑器继续整理。</p>
      <form onSubmit={(event) => { event.preventDefault(); if (prompt.trim()) onStart(); }}><label className="lm-sr-only" htmlFor="lm-home-prompt">导图主题</label>
        <textarea id="lm-home-prompt" value={prompt} maxLength={120} onChange={(event) => onPrompt(event.target.value)} placeholder="例如：帮我梳理一个新产品从用户调研到发布的计划…"/>
        <div className="lm-compose-actions"><span>输入一个主题，即可开始</span><button type="submit" className="lm-primary-button" disabled={!prompt.trim()}>开始整理 <ArrowRight size={16}/></button></div></form>
      <div className="lm-suggestion-row"><span>试试这些：</span>{["产品发布计划", "年度学习目标", "问题根因分析"].map((idea) => <button key={idea} type="button" onClick={() => onPrompt(idea)}>{idea}</button>)}</div>
      <div className="lm-outline-shortcut"><div><ListTreeIcon/><span><strong>已有大纲？</strong> 粘贴 Markdown、列表或缩进文本，保留完整层级。</span></div><button type="button" onClick={onOutline}>导入大纲 <ArrowUpRight size={15}/></button></div>
    </section>
    <div className="lm-home-foot"><span>LOOMIND / THINK IN SYSTEMS</span><AppLink href="/app/library">查看全部导图 <ArrowRight size={14}/></AppLink></div>
  </div>;
}

function ListTreeIcon() { return <span className="lm-outline-icon" aria-hidden="true">≡</span>; }

function CreateWorkspaceDialog({ open, onClose, onCreate }: { open: boolean; onClose: () => void; onCreate: (name: string) => Promise<void> }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { if (open) dialog.current?.showModal(); else dialog.current?.close(); }, [open]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    const clean = name.trim();
    if (!clean) return;
    setBusy(true);
    setError("");
    try { await onCreate(clean); dialog.current?.close(); setName(""); }
    catch (reason) { setError(errorText(reason, "无法创建工作区。")); }
    finally { setBusy(false); }
  }
  return <dialog ref={dialog} className="lm-modal" aria-labelledby="lm-create-space-title" onClose={onClose}><form className="lm-modal-inner" onSubmit={(event) => void submit(event)}>
    <div className="lm-modal-heading"><div><span className="lm-eyebrow">WORKSPACE / NEW</span><h2 id="lm-create-space-title">新建共享工作区</h2></div><button type="button" className="lm-icon-button" aria-label="关闭" onClick={() => dialog.current?.close()}><X size={18}/></button></div>
    <p className="lm-modal-description">工作区可以容纳多张导图。创建后，你可以生成邀请链接让其他账号加入。</p>
    <label htmlFor="lm-space-name">工作区名称</label><input id="lm-space-name" value={name} onChange={(event) => setName(event.target.value)} maxLength={64} placeholder="例如：产品团队" autoFocus/>
    {error && <p className="lm-form-error" role="alert">{error}</p>}
    <div className="lm-modal-actions"><button type="button" className="lm-secondary-button" onClick={() => dialog.current?.close()}>取消</button><button type="submit" className="lm-primary-button" disabled={busy || !name.trim()}>{busy ? "正在创建…" : "创建工作区"}<ArrowRight size={16}/></button></div>
  </form></dialog>;
}
