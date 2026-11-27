import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, History, PanelLeft, Share2 } from "lucide-react";
import { LocalImmerSyncAdapter, type MindmapDocument, type SyncAdapter } from "@mindmap/core";
import { MindmapEditor } from "@mindmap/editor";
import { useWebAiRuntime } from "./ai.js";
import { AccountControl } from "./auth/AccountControl.js";
import type { Session } from "./auth/shared.js";
import { readCloud } from "./drafts/cloud.js";
import { mapTitle, type MindmapSummary } from "./drafts/shared.js";
import { DraftWorkspace, type SyncState } from "./drafts/workspace.js";
import { useI18n } from "./i18n.js";
import { AppLink, navigate } from "./navigation.js";
import type { UiTheme } from "./ui.js";
import { VersionHistoryDialog } from "./VersionHistoryDialog.js";

function errorText(reason: unknown, fallback: string) {
  return reason instanceof Error ? reason.message : fallback;
}

export function EditorWorkspace({ map, owner, session, changeSession, theme, initialAiPrompt, onConsumeAiPrompt, onToggleSidebar, onRename, onShare, listError }: {
  map: MindmapSummary;
  owner: string;
  session: Session;
  changeSession: (session: Session) => void;
  theme: UiTheme;
  initialAiPrompt?: string;
  onConsumeAiPrompt?: () => void;
  onToggleSidebar: () => void;
  onRename: (id: string, title: string) => void;
  onShare: () => void;
  listError: string;
}) {
  if (map.access === "viewer") {
    return <ViewerEditor map={map} owner={owner} theme={theme} onToggleSidebar={onToggleSidebar} listError={listError}/>;
  }
  return <EditableEditor
    map={map}
    owner={owner}
    session={session}
    changeSession={changeSession}
    theme={theme}
    initialAiPrompt={initialAiPrompt}
    onConsumeAiPrompt={onConsumeAiPrompt}
    onToggleSidebar={onToggleSidebar}
    onRename={onRename}
    onShare={onShare}
    listError={listError}
  />;
}

function EditableEditor({ map, owner, session, changeSession, theme, initialAiPrompt, onConsumeAiPrompt, onToggleSidebar, onRename, onShare, listError }: {
  map: MindmapSummary;
  owner: string;
  session: Session;
  changeSession: (session: Session) => void;
  theme: UiTheme;
  initialAiPrompt?: string;
  onConsumeAiPrompt?: () => void;
  onToggleSidebar: () => void;
  onRename: (id: string, title: string) => void;
  onShare: () => void;
  listError: string;
}) {
  const { t } = useI18n();
  const proAiRuntime = useWebAiRuntime("pro");
  const [initial, setInitial] = useState<{ document: MindmapDocument; key: number }>();
  const [sync, setSync] = useState<SyncState>(() => ({ label: t.sync.connectingLabel, detail: t.sync.connectingDetail, status: "connecting" }));
  const [localError, setLocalError] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const workspace = useRef<DraftWorkspace | null>(null);
  const promptOnce = useRef(initialAiPrompt);

  useEffect(() => {
    if (initialAiPrompt) {
      promptOnce.current = initialAiPrompt;
      onConsumeAiPrompt?.();
    }
  }, [initialAiPrompt, onConsumeAiPrompt]);

  useEffect(() => {
    const current = new DraftWorkspace(owner, map.id,
      (document) => setInitial((old) => ({ document, key: (old?.key ?? 0) + 1 })), setSync, setLocalError,
      undefined, map.workspaceId, map.access);
    workspace.current = current;
    void current.start();
    const flush = () => void current.flush();
    const syncOnline = () => void current.sync();
    window.addEventListener("pagehide", flush);
    window.addEventListener("online", syncOnline);
    return () => {
      current.close();
      workspace.current = null;
      window.removeEventListener("pagehide", flush);
      window.removeEventListener("online", syncOnline);
    };
  }, [owner, map.id, map.workspaceId, map.access]);

  const edit = useCallback((document: MindmapDocument) => {
    workspace.current?.edit(document);
    onRename(map.id, mapTitle(document));
  }, [map.id, onRename]);

  const restoreRevision = useCallback((document: MindmapDocument) => {
    setInitial((old) => ({ document, key: (old?.key ?? 0) + 1 }));
    workspace.current?.edit(document);
    onRename(map.id, mapTitle(document));
  }, [map.id, onRename]);

  const downloadJson = useCallback((filename: string, json: string | null) => {
    if (!json) return;
    const blob = new Blob([json], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  }, []);

  if (!initial) return <div className="lm-loading">{t.common.openingMap}</div>;

  return <div className="lm-editor-host">
    {(localError || listError) && <div className="lm-editor-error" role="alert">{localError || listError}</div>}
    <MindmapEditor
      key={initial.key}
      initialDoc={initial.document}
      onDocumentChange={edit}
      chromeTheme={theme}
      initialFormatPanelOpen={false}
      initialAiPrompt={promptOnce.current}
      aiRuntime={proAiRuntime}
      accountControl={<div className="lm-editor-navigation">
        <button type="button" className="lm-icon-button-sm" title={t.workspace.toggleSidebarTitle} aria-label={t.workspace.toggleSidebarAria} onClick={onToggleSidebar}>
          <PanelLeft size={15}/>
        </button>
        <span className="lm-editor-map-title" title={map.title}>{map.title}</span>
        <button type="button" className="lm-editor-nav-btn" onClick={() => setHistoryOpen(true)} title={t.editorWorkspace.historyBtn}>
          <History size={12}/> {t.editorWorkspace.historyBtn}
        </button>
        {map.access === "owner" && (
          <button type="button" className="lm-editor-nav-btn" onClick={onShare}>
            <Share2 size={12}/> {t.editorWorkspace.shareBtn}
          </button>
        )}
        <AccountControl
          user={session.user}
          onSessionChange={(next) => { changeSession(next); if (!next.user) navigate("/", true); }}
          sync={sync}
          onSync={(useCloud) => void workspace.current?.sync(useCloud)}
          onLogin={() => navigate("/login")}
          onSaveAsNew={() => void workspace.current?.saveAsNewMap().then((newId) => { if (newId) navigate(`/app/mindmaps/${newId}`); })}
          onExportBackup={() => downloadJson(`loomind-backup-${map.id}.json`, workspace.current?.exportCurrentJson() ?? null)}
          onExportCorrupt={() => {
            const first = workspace.current?.getCorruptRecords()[0];
            if (first) downloadJson(`loomind-corrupt-${map.id}.json`, workspace.current?.exportCorruptRecordJson(first.corruptKey) ?? null);
          }}
          onDiscardCorrupt={() => {
            const first = workspace.current?.getCorruptRecords()[0];
            if (first) void workspace.current?.discardCorrupt(first.corruptKey);
          }}
          onRemoveLocalCache={() => void workspace.current?.removeCleanCache().then((res) => { if (res.removed) navigate("/app"); })}
        />
      </div>}
    />
    <VersionHistoryDialog
      open={historyOpen}
      owner={owner}
      mapId={map.id}
      mapTitle={map.title}
      onRestore={restoreRevision}
      onClose={() => setHistoryOpen(false)}
    />
  </div>;
}

function ViewerEditor({ map, owner, theme, onToggleSidebar, listError }: {
  map: MindmapSummary;
  owner: string;
  theme: UiTheme;
  onToggleSidebar: () => void;
  listError: string;
}) {
  const { t } = useI18n();
  const [document, setDocument] = useState<MindmapDocument | null>(null);
  const [error, setError] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  useEffect(() => {
    let active = true;
    void readCloud(owner, map.id).then((draft) => {
      if (!active) return;
      if (!draft.document) { setError(t.editorWorkspace.mapUnavailable); return; }
      setDocument(draft.document);
    }).catch((reason) => { if (active) setError(errorText(reason, t.editorWorkspace.readSharedError)); });
    return () => { active = false; };
  }, [owner, map.id, t.editorWorkspace.mapUnavailable, t.editorWorkspace.readSharedError]);
  const adapter = useMemo<SyncAdapter | null>(() => {
    if (!document) return null;
    const source = new LocalImmerSyncAdapter(document);
    return {
      getDocument: () => source.getDocument(),
      applyCommand: () => {},
      replaceDocument: () => {},
      undo: () => {},
      redo: () => {},
      canUndo: () => false,
      canRedo: () => false,
      subscribe: (listener) => source.subscribe(listener),
    };
  }, [document]);
  if (error) return <div className="lm-not-found"><span className="lm-eyebrow">{t.editorWorkspace.unavailableEyebrow}</span><h1>{t.editorWorkspace.cannotOpenShared}</h1><p role="alert">{error}</p><AppLink href="/app" className="lm-primary-button">{t.notFound.backToWorkspace} <ArrowRight size={16}/></AppLink></div>;
  if (!adapter) return <div className="lm-loading">{t.editorWorkspace.loadingShared}</div>;
  return <div className="lm-editor-host lm-viewer-editor">
    {listError && <div className="lm-editor-error" role="alert">{listError}</div>}
    <span className="lm-readonly-badge">{t.editorWorkspace.readonlyBanner}</span>
    <MindmapEditor
      adapter={adapter}
      chromeTheme={theme}
      readOnly
      initialFormatPanelOpen={false}
      accountControl={<div className="lm-editor-navigation">
        <button type="button" className="lm-icon-button-sm" title={t.workspace.toggleSidebarTitle} aria-label={t.workspace.toggleSidebarAria} onClick={onToggleSidebar}>
          <PanelLeft size={15}/>
        </button>
        <span className="lm-editor-map-title" title={map.title}>{map.title}</span>
        <button type="button" className="lm-editor-nav-btn" onClick={() => setHistoryOpen(true)} title={t.editorWorkspace.historyBtn}>
          <History size={12}/> {t.editorWorkspace.historyBtn}
        </button>
        <span className="lm-editor-viewer-label">{t.common.readOnly}</span>
      </div>}
    />
    <VersionHistoryDialog
      open={historyOpen}
      owner={owner}
      mapId={map.id}
      mapTitle={map.title}
      readOnly
      onClose={() => setHistoryOpen(false)}
    />
  </div>;
}
