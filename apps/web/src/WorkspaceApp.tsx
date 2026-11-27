import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  ArrowRight,
  Command,
  FolderOpen,
  GitBranch,
  Languages,
  Layers,
  LogOut,
  Menu,
  PanelLeft,
  Plus,
  Search,
  Share2,
  Sparkles,
  SquarePen,
  Users,
  X,
} from "lucide-react";
import { getIntlLocale, type MindmapDocument } from "@mindmap/core";
import { authRequest } from "./auth/session.js";
import type { Session } from "./auth/shared.js";
import { createWorkspace, listWorkspaces, moveMindmap, type WorkspaceSummary } from "./api.js";
import { CreateView } from "./CreateView.js";
import { clearLocalAiChatCache, seedLocalAiChatCache } from "./drafts/ai-chat.js";
import { deleteCloud, listCloud } from "./drafts/cloud.js";
import { mapTitle, MAP_ID, type MindmapSummary } from "./drafts/shared.js";
import { useI18n } from "./i18n.js";
import { formatRelativeTime, LibraryView } from "./LibraryView.js";
import { MapThumbnail } from "./MapThumbnail.js";
import { AppLink, navigate } from "./navigation.js";
import { documentFromOutline, documentFromTopic, outlineNodeCount, parseOutline } from "./outline.js";
import { OutlineTree } from "./OutlineTree.js";
import { deleteLocal, listLocalMaps, loadLocal, saveLocal } from "./persistence.js";
import { ShareDialog, type ShareTarget } from "./ShareDialog.js";
import { consumeStagedTryChat, consumeStagedTryDocument } from "./try-handoff.js";
import { Brand, LanguageToggle, ThemeToggle, type UiTheme } from "./ui.js";

const EditorWorkspace = lazy(() => import("./EditorWorkspace.js").then(({ EditorWorkspace }) => ({ default: EditorWorkspace })));

interface Props {
  route: { pathname: string; search: string };
  session: Session;
  changeSession: (session: Session) => void;
  theme: UiTheme;
  toggleTheme: () => void;
}

const TEMPLATE_IDS = ["blank-organic", "quarterly-okr", "annual-roadmap", "root-cause-fishbone"] as const;

function errorText(reason: unknown, fallback: string) {
  return reason instanceof Error ? reason.message : fallback;
}

function sortMaps(items: MindmapSummary[]) {
  return [...items].sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
}

export function WorkspaceApp({ route, session, changeSession, theme, toggleTheme }: Props) {
  const { t, toggleLocale } = useI18n();
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
  const [pendingAiPrompt, setPendingAiPrompt] = useState<string | undefined>(undefined);
  const [shareTarget, setShareTarget] = useState<ShareTarget | null>(null);
  const [workspaceDialogOpen, setWorkspaceDialogOpen] = useState(false);
  const [cmdkOpen, setCmdkOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const drawerClose = useRef<HTMLButtonElement>(null);

  const editorMatch = /^\/app\/mindmaps\/([^/]+)$/.exec(route.pathname);
  const mapId = editorMatch?.[1] ?? null;
  const [sidebarCollapsed, setSidebarCollapsed] = useState(Boolean(mapId));

  const toggleSidebar = useCallback(() => {
    if (window.matchMedia("(max-width: 800px)").matches) setMobileOpen((open) => !open);
    else setSidebarCollapsed((collapsed) => !collapsed);
  }, []);

  useEffect(() => {
    if (!mobileOpen) return;
    const opener = document.querySelector<HTMLButtonElement>('.lm-app-column [aria-controls="lm-workspace-sidebar"]');
    const drawer = drawerClose.current?.closest("aside");
    drawerClose.current?.focus();
    const mobile = window.matchMedia("(max-width: 800px)");
    const closeOnDesktop = () => { if (!mobile.matches) setMobileOpen(false); };
    mobile.addEventListener("change", closeOnDesktop);
    return () => {
      mobile.removeEventListener("change", closeOnDesktop);
      const focused = document.activeElement;
      if (mobile.matches && opener?.isConnected && (focused === document.body || drawer?.contains(focused))) {
        opener.focus({ preventScroll: true });
      }
    };
  }, [mobileOpen]);

  // Auto-collapse sidebar when entering editor to maximize canvas; restore on workspace pages
  const prevInEditor = useRef(Boolean(mapId));
  useEffect(() => {
    const inEditor = Boolean(mapId);
    if (inEditor !== prevInEditor.current) {
      setSidebarCollapsed(inEditor);
      prevInEditor.current = inEditor;
    }
  }, [mapId]);

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
      } catch (reason) { failures.push(errorText(reason, t.workspace.readLocalError)); }
      let remote: MindmapSummary[] | null = null;
      try { remote = await listCloud(owner); }
      catch (reason) { failures.push(errorText(reason, t.workspace.readCloudError)); }
      let spaces: WorkspaceSummary[] = [];
      try { spaces = await listWorkspaces(); }
      catch (reason) { failures.push(errorText(reason, t.workspace.readSpacesError)); }
      if (!active) return;
      const merged = remote
        ? [
            ...remote,
            ...local
              .filter((item) => !remote!.some((cloud) => cloud.id === item.id))
              .map((item) => ({ ...item, localOnly: true })),
          ]
        : local;
      setMaps(sortMaps(merged));
      setWorkspaces(spaces);
      setActiveWorkspaceId((current) => current && spaces.some((space) => space.id === current) ? current : null);
      setListError(failures.join(" "));
      setLoading(false);

      if (new URLSearchParams(window.location.search).get("importTry") === "1") {
        const importedDoc = consumeStagedTryDocument();
        const importedChat = consumeStagedTryChat();
        if (importedDoc) {
          const id = crypto.randomUUID();
          await saveLocal(owner, { document: importedDoc, revision: 0, dirty: true, workspaceId: null, access: "owner" }, id);
          if (importedChat?.length) {
            seedLocalAiChatCache(owner, id, importedChat);
          }
          if (!active) return;
          setMaps((current) => sortMaps([
            { id, title: mapTitle(importedDoc), updatedAt: new Date().toISOString(), workspaceId: null, access: "owner" },
            ...current,
          ]));
          setActiveWorkspaceId(null);
          navigate(`/app/mindmaps/${id}`, true);
        } else {
          navigate("/app", true);
        }
      }
    })();
    return () => { active = false; };
  }, [owner]);

  useEffect(() => {
    try { localStorage.setItem(`loomind:space:${owner}`, activeWorkspaceId ?? ""); } catch { /* Optional preference. */ }
  }, [owner, activeWorkspaceId]);

  // Global shortcuts: [ toggles sidebar, Cmd/Ctrl+K opens Workspace CommandK when outside editor
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      const inInput = event.target instanceof HTMLElement &&
        (event.target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName));

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k" && !mapId) {
        event.preventDefault();
        setCmdkOpen((open) => !open);
      } else if (event.key === "[" && !event.ctrlKey && !event.metaKey && !event.altKey && !inInput) {
        event.preventDefault();
        toggleSidebar();
      } else if (event.key.toLowerCase() === "n" && !event.ctrlKey && !event.metaKey && !event.altKey && !inInput && !mapId) {
        event.preventDefault();
        navigate("/app");
        window.setTimeout(() => document.getElementById("lm-home-prompt")?.focus(), 0);
      }
    };
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, [mapId, toggleSidebar]);

  const recent = useMemo(() => sortMaps(maps.filter((map) => map.workspaceId === activeWorkspaceId)).slice(0, 6), [maps, activeWorkspaceId]);

  async function createMap(document: MindmapDocument, workspaceId: string | null, aiPrompt?: string) {
    const id = crypto.randomUUID();
    await saveLocal(owner, { document, revision: 0, dirty: true, workspaceId, access: "owner" }, id);
    setMaps((current) => [{ id, title: mapTitle(document), updatedAt: new Date().toISOString(), workspaceId, access: "owner" }, ...current]);
    setActiveWorkspaceId(workspaceId);
    setPendingAiPrompt(aiPrompt);
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
    clearLocalAiChatCache(owner, map.id);
    setMaps((current) => current.filter((item) => item.id !== map.id));
  }

  const rename = useCallback((id: string, title: string) => {
    setMaps((current) => current.map((item) => item.id === id ? { ...item, title, updatedAt: new Date().toISOString() } : item));
  }, []);

  const consumeAiPrompt = useCallback(() => setPendingAiPrompt(undefined), []);

  async function logout() {
    try {
      const next = await authRequest<Session>("logout");
      changeSession(next);
      navigate("/", true);
    } catch (reason) { setActionError(errorText(reason, t.workspace.logoutFailed)); }
  }

  if (loading) return <div className="lm-loading">{t.common.openingWorkspace}</div>;

  const isLibrary = route.pathname === "/app/library";
  const isShared = route.pathname === "/app/shared";
  const isCreate = route.pathname === "/app/create";
  const createMode = new URLSearchParams(route.search).get("mode") === "outline" ? "outline" : "idea";
  const chooseSpace = (id: string | null) => {
    setActiveWorkspaceId(id);
    setMobileOpen(false);
    if (mapId) navigate("/app");
  };

  const activeMap = mapId && MAP_ID.test(mapId) ? maps.find((item) => item.id === mapId) : undefined;

  return <div className={`lm-app-shell ${sidebarCollapsed ? "is-sidebar-collapsed" : ""}`}>
    <aside id="lm-workspace-sidebar" className={`lm-sidebar ${mobileOpen ? "is-open" : ""}`} aria-label={t.workspace.sidebarAria}
      onKeyDown={(event) => { if (mobileOpen && event.key === "Escape") setMobileOpen(false); }}>
      <div className="lm-sidebar-head">
        <Brand to="/app" compact onClick={() => setMobileOpen(false)}/>
        <button type="button" className="lm-icon-button-sm lm-sidebar-collapse-btn" title={t.workspace.toggleSidebarTitle} aria-label={t.workspace.toggleSidebarAria} onClick={() => setSidebarCollapsed(true)}><PanelLeft size={15}/></button>
        <button ref={drawerClose} type="button" className="lm-mobile-close" aria-label={t.workspace.closeSidebarAria} onClick={() => setMobileOpen(false)}><X size={15}/></button>
      </div>

      <nav className="lm-sidebar-nav" aria-label={t.workspace.mainNavAria}>
        <button type="button" className="lm-nav-item lm-nav-search" onClick={() => { setMobileOpen(false); setCmdkOpen(true); }}>
          <Search size={14}/><span>{t.workspace.navSearch}</span><kbd><Command size={10}/>K</kbd>
        </button>
        <AppLink href="/app" className={`lm-nav-item ${route.pathname === "/app" ? "is-active" : ""}`} onClick={() => setMobileOpen(false)}>
          <SquarePen size={14}/><span>{t.workspace.navHome}</span><kbd>N</kbd>
        </AppLink>
        <AppLink href="/app/library" className={`lm-nav-item ${isLibrary || isShared ? "is-active" : ""}`} onClick={() => setMobileOpen(false)}>
          <FolderOpen size={14}/><span>{t.workspace.navLibrary}</span>
        </AppLink>
      </nav>

      <section className="lm-sidebar-section" aria-label={t.workspace.selectSpaceAria}>
        {workspaces.length === 0 ? (
          <button
            type="button"
            className="lm-workspace-empty-row"
            title={t.workspace.newSpace}
            aria-label={t.workspace.newSpace}
            onClick={() => setWorkspaceDialogOpen(true)}
          >
            <span>{t.workspace.spacesEyebrow}</span>
            <Plus size={12}/>
          </button>
        ) : (
          <>
            <div className="lm-sidebar-section-title">
              <span>{t.workspace.spacesEyebrow}</span>
              <button
                type="button"
                className="lm-sidebar-section-action"
                title={t.workspace.newSpace}
                aria-label={t.workspace.newSpace}
                onClick={() => setWorkspaceDialogOpen(true)}
              >
                <Plus size={12}/>
              </button>
            </div>
            <div className="lm-space-list">
              <button
                type="button"
                className={`lm-space-item ${!activeWorkspaceId ? "is-selected" : ""}`}
                aria-pressed={!activeWorkspaceId}
                onClick={() => chooseSpace(null)}
              >
                <Layers size={13} className="lm-space-icon"/>
                <span className="lm-space-name">{t.common.myMaps}</span>
                {!activeWorkspaceId && <span className="lm-space-active-dot" aria-hidden="true"/>}
              </button>
              {workspaces.map((space) => {
                const selected = activeWorkspaceId === space.id;
                return (
                  <div key={space.id} className={`lm-space-row ${selected ? "is-selected" : ""}`}>
                    <button
                      type="button"
                      className={`lm-space-item ${selected ? "is-selected" : ""}`}
                      aria-pressed={selected}
                      onClick={() => chooseSpace(space.id)}
                    >
                      <span className="lm-space-glyph" aria-hidden="true">{space.name.slice(0, 1).toUpperCase()}</span>
                      <span className="lm-space-name">{space.name}</span>
                      {selected && space.role !== "owner" && <span className="lm-space-active-dot" aria-hidden="true"/>}
                    </button>
                    {space.role === "owner" && (
                      <button
                        type="button"
                        className="lm-space-share-btn"
                        title={t.workspace.shareSpace}
                        aria-label={`${t.workspace.shareSpace}: ${space.name}`}
                        onClick={() => setShareTarget({ type: "workspace", id: space.id, name: space.name })}
                      >
                        <Share2 size={12}/>
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </section>

      <div className="lm-sidebar-spacer" aria-hidden="true"/>

      <div className="lm-sidebar-bottom">
        <div className="lm-sidebar-account-btn" title={session.user!.email}>
          <span className="lm-account-avatar">{session.user!.email.slice(0, 1).toUpperCase()}</span>
          <div>
            <strong>{session.user!.email.split("@")[0]}</strong>
            <small>{session.user!.email}</small>
          </div>
        </div>
        <div className="lm-sidebar-bottom-actions">
          <LanguageToggle compact/>
          <ThemeToggle theme={theme} toggle={toggleTheme} compact/>
          <button type="button" className="lm-icon-button-sm" title={t.workspace.logoutTitle} aria-label={t.workspace.logoutTitle} onClick={() => void logout()}>
            <LogOut size={14}/>
          </button>
        </div>
      </div>
    </aside>

    {mobileOpen && <button type="button" tabIndex={-1} className="lm-sidebar-scrim" aria-label={t.workspace.closeSidebarAria} onClick={() => setMobileOpen(false)}/>}

    <div className="lm-app-column" inert={mobileOpen}>
      {mapId ? (
        activeMap ? (
          <Suspense fallback={<div className="lm-loading">{t.common.openingMap}</div>}>
            <EditorWorkspace
              key={activeMap.id}
              map={activeMap}
              owner={owner}
              session={session}
              changeSession={changeSession}
              theme={theme}
              initialAiPrompt={pendingAiPrompt}
              onConsumeAiPrompt={consumeAiPrompt}
              onToggleSidebar={toggleSidebar}
              onRename={rename}
              onShare={() => setShareTarget({ type: "mindmap", id: activeMap.id, name: activeMap.title })}
              listError={listError}
            />
          </Suspense>
        ) : (
          <div className="lm-not-found">
            <span className="lm-eyebrow">{t.notFound.eyebrow}</span>
            <h1>{t.notFound.mapTitle}</h1>
            <p>{t.notFound.mapDesc}</p>
            <AppLink href="/app/library" className="lm-primary-button">{t.notFound.backToLibrary} <ArrowRight size={15}/></AppLink>
          </div>
        )
      ) : (
        <main className="lm-main-area">
          <button type="button" className="lm-floating-sidebar-btn lm-mobile-menu" aria-label={t.workspace.openSidebarAria} aria-controls="lm-workspace-sidebar" aria-expanded={mobileOpen} onClick={toggleSidebar}><Menu size={16}/></button>
          {sidebarCollapsed && (
            <button type="button" className="lm-floating-sidebar-btn lm-desktop-expand" title={t.workspace.toggleSidebarTitle} aria-label={t.workspace.toggleSidebarAria} onClick={() => setSidebarCollapsed(false)}><PanelLeft size={15}/></button>
          )}

          {(listError || actionError) && (
            <div className="lm-app-alert" role="alert">
              {actionError || listError}
              <button type="button" onClick={() => { setActionError(""); setListError(""); }}>{t.common.close}</button>
            </div>
          )}

          {isLibrary ? (
            <LibraryView key="library" maps={maps} workspaces={workspaces} onShare={(map) => setShareTarget({ type: "mindmap", id: map.id, name: map.title })} onMove={moveMap} onDelete={deleteMap}/>
          ) : isShared ? (
            <LibraryView key="shared" maps={maps} workspaces={workspaces} initialFilter="shared" isSharedView onShare={(map) => setShareTarget({ type: "mindmap", id: map.id, name: map.title })} onMove={moveMap} onDelete={deleteMap}/>
          ) : isCreate ? (
            <CreateView
              mode={createMode}
              initialPrompt=""
              activeWorkspaceId={activeWorkspaceId}
              workspaces={workspaces}
              onModeChange={(mode) => navigate(`/app/create${mode === "outline" ? "?mode=outline" : ""}`, true)}
              onCreate={(doc, wsId, aiPrompt) => createMap(doc, wsId, aiPrompt)}
            />
          ) : route.pathname === "/app" ? (
            <HomeComposerView
              owner={owner}
              activeWorkspaceId={activeWorkspaceId}
              workspaces={workspaces}
              recentMaps={recent}
              onCreate={createMap}
            />
          ) : (
            <div className="lm-content lm-not-found-inline">
              <h1>{t.notFound.pageTitle}</h1>
              <AppLink href="/app" className="lm-primary-button">{t.notFound.backToWorkspace} <ArrowRight size={15}/></AppLink>
            </div>
          )}
        </main>
      )}
    </div>

    <ShareDialog target={shareTarget} onClose={() => setShareTarget(null)}/>
    <CreateWorkspaceDialog open={workspaceDialogOpen} onClose={() => setWorkspaceDialogOpen(false)} onCreate={createSpace}/>
    <WorkspaceCommandK
      open={cmdkOpen}
      maps={maps}
      workspaces={workspaces}
      onClose={() => setCmdkOpen(false)}
      onSelectSpace={chooseSpace}
      onToggleTheme={toggleTheme}
      onToggleLocale={() => { toggleLocale(); }}
      onQuickAiCreate={async (prompt) => {
        const doc = documentFromTopic(prompt, "blank-organic");
        await createMap(doc, activeWorkspaceId, prompt);
      }}
    />
  </div>;
}

function HomeComposerView({ owner, activeWorkspaceId, workspaces, recentMaps, onCreate }: {
  owner: string;
  activeWorkspaceId: string | null;
  workspaces: WorkspaceSummary[];
  recentMaps: MindmapSummary[];
  onCreate: (document: MindmapDocument, workspaceId: string | null, aiPrompt?: string) => Promise<void>;
}) {
  const { locale, t } = useI18n();
  const writable = workspaces.filter((space) => space.role !== "viewer");
  const [text, setText] = useState("");
  const [templateId, setTemplateId] = useState("blank-organic");
  const [workspaceId, setWorkspaceId] = useState<string | null>(() =>
    writable.some((space) => space.id === activeWorkspaceId) ? activeWorkspaceId : null,
  );
  const [showPreview, setShowPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [localDocs, setLocalDocs] = useState<Record<string, MindmapDocument>>({});

  useEffect(() => {
    setWorkspaceId(writable.some((space) => space.id === activeWorkspaceId) ? activeWorkspaceId : null);
  }, [activeWorkspaceId, workspaces]);

  const recentIdsKey = recentMaps.map((m) => m.id).join(",");
  useEffect(() => {
    let active = true;
    if (!recentMaps.length) return;
    void Promise.all(
      recentMaps.map(async (map) => {
        try {
          const local = await loadLocal(owner, map.id);
          return local?.document ? ([map.id, local.document] as const) : null;
        } catch {
          return null;
        }
      }),
    ).then((entries) => {
      if (!active) return;
      const next: Record<string, MindmapDocument> = {};
      for (const entry of entries) {
        if (entry) next[entry[0]] = entry[1];
      }
      setLocalDocs(next);
    });
    return () => { active = false; };
  }, [owner, recentIdsKey]);

  const isMultiLine = text.includes("\n");
  const parsedOutline = useMemo(() => {
    if (!isMultiLine || !text.trim()) return null;
    try {
      const parsed = parseOutline(text);
      return parsed.children.length > 0 ? parsed : null;
    } catch {
      return null;
    }
  }, [text, isMultiLine]);

  async function handleSubmit(event?: FormEvent) {
    event?.preventDefault();
    const clean = text.trim();
    if (!clean || busy) return;
    setBusy(true);
    setError("");
    try {
      if (parsedOutline) {
        const doc = documentFromOutline(parsedOutline, templateId);
        await onCreate(doc, workspaceId);
      } else {
        const doc = documentFromTopic(clean, templateId);
        await onCreate(doc, workspaceId, clean);
      }
    } catch (reason) {
      setError(errorText(reason, t.home.createError));
    } finally {
      setBusy(false);
    }
  }

  return <div className={`lm-home-stage ${recentMaps.length === 0 ? "is-empty" : ""}`}>
    <div className="lm-home-atmosphere" aria-hidden="true">
      <div className="lm-ambient-glow" />
      <div className="lm-home-dotgrid" />
    </div>
    <div className="lm-content lm-home">
      <div className="lm-home-hero">
        <div className="lm-home-heading">
          <h1>
            {t.home.headingPrefix}
            <span>{t.home.headingAccent}</span>
          </h1>
        </div>

        <form className="lm-composer" onSubmit={(e) => void handleSubmit(e)}>
          <label className="lm-sr-only" htmlFor="lm-home-prompt">{t.home.promptLabel}</label>
          <textarea
            id="lm-home-prompt"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                e.preventDefault();
                void handleSubmit();
              }
            }}
            placeholder={t.home.promptPlaceholder}
          />

          {parsedOutline && (
            <>
              <div className="lm-composer-outline-pill">
                <span>{t.home.outlineDetected(outlineNodeCount(parsedOutline), parsedOutline.children.length)}</span>
                <button type="button" className="lm-text-button" style={{ marginTop: 0 }} onClick={() => setShowPreview((v) => !v)}>
                  {showPreview ? t.home.hidePreview : t.home.showPreview}
                </button>
              </div>
              {showPreview && (
                <div className="lm-composer-outline-preview">
                  <OutlineTree outline={parsedOutline}/>
                </div>
              )}
            </>
          )}

          <div className="lm-composer-bar">
            <div className="lm-composer-controls">
              <label className="lm-chip-select" title={t.home.templateTitle}>
                <GitBranch size={12}/>
                <select aria-label={t.home.templateAria} value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
                  {TEMPLATE_IDS.map((id) => <option key={id} value={id}>{t.workspace.templates[id] ?? id}</option>)}
                </select>
              </label>
              {writable.length > 0 && (
                <label className="lm-chip-select" title={t.home.spaceTitle}>
                  <FolderOpen size={12}/>
                  <select aria-label={t.home.spaceAria} value={workspaceId ?? ""} onChange={(e) => setWorkspaceId(e.target.value || null)}>
                    <option value="">{t.common.myMaps}</option>
                    {writable.map((space) => <option key={space.id} value={space.id}>{space.name}</option>)}
                  </select>
                </label>
              )}
            </div>

            <div className="lm-composer-submit-group">
              <span className="lm-composer-shortcut" aria-hidden="true">{t.home.shortcutHint}</span>
              <button type="submit" className="lm-primary-button lm-composer-submit" disabled={busy || !text.trim()}>
                <Sparkles size={13}/>
                {busy ? t.home.creating : parsedOutline ? t.home.createFromOutline : t.home.createWithAi}
              </button>
            </div>
          </div>
        </form>

        {error && <p className="lm-form-error" role="alert">{error}</p>}

        <div className="lm-suggestion-row">
          {t.home.suggestions.map((idea) => (
            <button key={idea} type="button" onClick={() => setText(idea)}>
              {idea}
            </button>
          ))}
        </div>
      </div>

      {recentMaps.length > 0 && (
        <section className="lm-home-recent" aria-label={t.home.recentAria}>
          <div className="lm-home-recent-head">
            <span className="lm-eyebrow">{t.home.recentHeading}</span>
            <AppLink href="/app/library">{t.home.viewAll} <ArrowRight size={12}/></AppLink>
          </div>
          <div className="lm-recent-grid" role="list">
            {recentMaps.map((map) => (
              <AppLink key={map.id} href={`/app/mindmaps/${map.id}`} className="lm-recent-card" role="listitem">
                <div className="lm-recent-thumb">
                  <MapThumbnail doc={localDocs[map.id]} title={map.title} mapId={map.id}/>
                </div>
                <div className="lm-recent-card-meta">
                  <strong>{map.title}</strong>
                  <span>{formatRelativeTime(map.updatedAt, locale)}</span>
                </div>
              </AppLink>
            ))}
          </div>
        </section>
      )}
    </div>
  </div>;
}

function WorkspaceCommandK({ open, maps, workspaces, onClose, onSelectSpace, onToggleTheme, onToggleLocale, onQuickAiCreate }: {
  open: boolean;
  maps: MindmapSummary[];
  workspaces: WorkspaceSummary[];
  onClose: () => void;
  onSelectSpace: (id: string | null) => void;
  onToggleTheme: () => void;
  onToggleLocale: () => void;
  onQuickAiCreate: (prompt: string) => Promise<void>;
}) {
  const { locale, t } = useI18n();
  const intlLocale = getIntlLocale(locale);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!open) { setQuery(""); return; }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const filteredMaps = useMemo(() => {
    const q = query.trim().toLocaleLowerCase(intlLocale);
    return (q ? maps.filter((m) => m.title.toLocaleLowerCase(intlLocale).includes(q)) : maps).slice(0, 6);
  }, [maps, query, intlLocale]);

  if (!open) return null;

  return <div className="lm-cmdk-overlay" onClick={onClose}>
    <div className="lm-cmdk-box" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={t.cmdk.dialogAria}>
      <div className="lm-cmdk-input-row">
        <Search size={15}/>
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t.cmdk.placeholder}
          onKeyDown={(e) => {
            if (e.key === "Enter" && query.trim() && filteredMaps.length === 0) {
              e.preventDefault();
              onClose();
              void onQuickAiCreate(query.trim());
            }
          }}
        />
      </div>
      <div className="lm-cmdk-list">
        {query.trim() && (
          <>
            <div className="lm-cmdk-group-title">{t.cmdk.groupAi}</div>
            <button
              type="button"
              className="lm-cmdk-item is-accent"
              onClick={() => { onClose(); void onQuickAiCreate(query.trim()); }}
            >
              <Sparkles size={14}/>
              <span>{t.cmdk.createWithAi(query.trim())}</span>
            </button>
          </>
        )}

        {filteredMaps.length > 0 && (
          <>
            <div className="lm-cmdk-group-title">{t.cmdk.groupMaps}</div>
            {filteredMaps.map((m) => (
              <button
                key={m.id}
                type="button"
                className="lm-cmdk-item"
                onClick={() => { onClose(); navigate(`/app/mindmaps/${m.id}`); }}
              >
                <GitBranch size={13}/>
                <span>{m.title}</span>
                <small>{formatRelativeTime(m.updatedAt, locale)}</small>
              </button>
            ))}
          </>
        )}

        <div className="lm-cmdk-group-title">{t.cmdk.groupActions}</div>
        <button type="button" className="lm-cmdk-item" onClick={() => { onClose(); navigate("/app"); }}>
          <Plus size={13}/><span>{t.cmdk.newMap}</span>
        </button>
        <button type="button" className="lm-cmdk-item" onClick={() => { onClose(); navigate("/app/library"); }}>
          <FolderOpen size={13}/><span>{t.cmdk.openLibrary}</span>
        </button>
        <button type="button" className="lm-cmdk-item" onClick={() => { onToggleTheme(); onClose(); }}>
          <Sparkles size={13}/><span>{t.cmdk.toggleTheme}</span>
        </button>
        <button type="button" className="lm-cmdk-item" onClick={() => { onToggleLocale(); onClose(); }}>
          <Languages size={13}/><span>{t.cmdk.toggleLang}</span>
        </button>
        {workspaces.map((ws) => (
          <button key={ws.id} type="button" className="lm-cmdk-item" onClick={() => { onSelectSpace(ws.id); onClose(); }}>
            <Users size={13}/><span>{t.cmdk.switchSpace(ws.name)}</span>
          </button>
        ))}
      </div>
    </div>
  </div>;
}

function CreateWorkspaceDialog({ open, onClose, onCreate }: { open: boolean; onClose: () => void; onCreate: (name: string) => Promise<void> }) {
  const { t } = useI18n();
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
    catch (reason) { setError(errorText(reason, t.createSpaceDialog.failed)); }
    finally { setBusy(false); }
  }
  return <dialog ref={dialog} className="lm-modal" aria-labelledby="lm-create-space-title" onClose={onClose}><form className="lm-modal-inner" onSubmit={(event) => void submit(event)}>
    <div className="lm-modal-heading"><div><span className="lm-eyebrow">{t.createSpaceDialog.eyebrow}</span><h2 id="lm-create-space-title">{t.createSpaceDialog.title}</h2></div><button type="button" className="lm-icon-button-sm" aria-label={t.common.close} onClick={() => dialog.current?.close()}><X size={15}/></button></div>
    <p className="lm-modal-description">{t.createSpaceDialog.desc}</p>
    <label htmlFor="lm-space-name">{t.createSpaceDialog.nameLabel}</label><input id="lm-space-name" value={name} onChange={(event) => setName(event.target.value)} maxLength={64} placeholder={t.createSpaceDialog.namePlaceholder} autoFocus/>
    {error && <p className="lm-form-error" role="alert">{error}</p>}
    <div className="lm-modal-actions"><button type="button" className="lm-secondary-button" onClick={() => dialog.current?.close()}>{t.common.cancel}</button><button type="submit" className="lm-primary-button" disabled={busy || !name.trim()}>{busy ? t.createSpaceDialog.creating : t.createSpaceDialog.submit}</button></div>
  </form></dialog>;
}
