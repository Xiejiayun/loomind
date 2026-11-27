import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { History, PanelLeft, Share2 } from "lucide-react";
import {
  hex8ToCss,
  LocalImmerSyncAdapter,
  type MindmapDocument,
  type PeerPresence,
  type SyncAdapter,
} from "@mindmap/core";
import type { LoroSyncAdapter } from "@mindmap/core/loro";
import { MindmapEditor } from "@mindmap/editor";
import { useWebAiRuntime } from "./ai.js";
import { AccountControl } from "./auth/AccountControl.js";
import type { Session } from "./auth/shared.js";
import { ReadOnlyMap } from "./ReadOnlyMap.js";
import { createMapAiChatPersistence } from "./drafts/ai-chat.js";
import { CollabSession, randomLoroPeerId } from "./drafts/collab.js";
import { mapTitle, type MindmapSummary } from "./drafts/shared.js";
import { DraftWorkspace, type SyncState } from "./drafts/workspace.js";
import { useI18n } from "./i18n.js";
import { navigate } from "./navigation.js";
import type { UiTheme } from "./ui.js";
import { VersionHistoryDialog } from "./VersionHistoryDialog.js";

function PeerPresenceStrip({ peers, label }: { peers: PeerPresence[]; label: (count: number) => string }) {
  if (peers.length === 0) return null;
  return (
    <div className="lm-collab-peers" title={label(peers.length)} aria-label={label(peers.length)}>
      {peers.slice(0, 4).map((peer) => (
        <span
          key={peer.peerId}
          className="lm-collab-avatar"
          style={{ backgroundColor: hex8ToCss(peer.color) }}
          title={peer.name}
        >
          {peer.name.slice(0, 1).toUpperCase()}
        </span>
      ))}
      {peers.length > 4 && <span className="lm-collab-more">+{peers.length - 4}</span>}
    </div>
  );
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
  const [loroReady, setLoroReady] = useState<{ ctor: typeof LoroSyncAdapter | null; loaded: boolean }>({ ctor: null, loaded: false });
  const [remotePeers, setRemotePeers] = useState<PeerPresence[]>([]);
  const [sync, setSync] = useState<SyncState>(() => ({ label: t.sync.connectingLabel, detail: t.sync.connectingDetail, status: "connecting" }));
  const [localError, setLocalError] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const workspace = useRef<DraftWorkspace | null>(null);
  const collabRef = useRef<CollabSession | null>(null);
  const promptOnce = useRef(initialAiPrompt);
  const chatPersistence = useMemo(
    () => createMapAiChatPersistence(owner, map.id, false),
    [owner, map.id],
  );

  useEffect(() => {
    if (sync.status === "synced") {
      void chatPersistence.flushPending?.();
    }
  }, [sync.status, chatPersistence]);

  useEffect(() => {
    let active = true;
    void import("@mindmap/core/loro")
      .then((mod) => { if (active) setLoroReady({ ctor: mod.LoroSyncAdapter, loaded: true }); })
      .catch(() => { if (active) setLoroReady({ ctor: null, loaded: true }); });
    return () => { active = false; };
  }, []);

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
    if (collabRef.current?.isApplyingRemote()) {
      workspace.current?.acceptRemoteDocument(document);
    } else {
      workspace.current?.edit(document);
    }
    onRename(map.id, mapTitle(document));
  }, [map.id, onRename]);

  const restoreRevision = useCallback((document: MindmapDocument) => {
    setInitial((old) => ({ document, key: (old?.key ?? 0) + 1 }));
    workspace.current?.edit(document);
    onRename(map.id, mapTitle(document));
  }, [map.id, onRename]);

  const editorAdapter = useMemo<SyncAdapter | null>(() => {
    if (!initial || !loroReady.loaded) return null;
    if (loroReady.ctor) {
      return new loroReady.ctor(initial.document, randomLoroPeerId());
    }
    return new LocalImmerSyncAdapter(initial.document);
  }, [initial, loroReady]);

  const displayName = session.user?.email.split("@")[0] || "Collaborator";

  useEffect(() => {
    if (!editorAdapter || !loroReady.ctor || !(editorAdapter instanceof loroReady.ctor)) {
      setRemotePeers([]);
      return;
    }
    const collab = new CollabSession(
      owner,
      map.id,
      displayName,
      editorAdapter,
      false,
      setRemotePeers,
      (doc) => onRename(map.id, mapTitle(doc)),
    );
    collabRef.current = collab;
    collab.start();
    return () => {
      collab.close();
      collabRef.current = null;
    };
  }, [editorAdapter, loroReady.ctor, owner, map.id, displayName, onRename]);

  const handleSelectionChange = useCallback((topicIds: string[]) => {
    collabRef.current?.setLocalSelection(topicIds);
  }, []);

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

  if (!initial || !editorAdapter) return <div className="lm-loading">{t.common.openingMap}</div>;

  return <div className="lm-editor-host">
    {(localError || listError) && <div className="lm-editor-error" role="alert">{localError || listError}</div>}
    <MindmapEditor
      key={initial.key}
      adapter={editorAdapter}
      onDocumentChange={edit}
      remotePeers={remotePeers}
      onSelectionChange={handleSelectionChange}
      chromeTheme={theme}
      initialFormatPanelOpen={false}
      initialAiPrompt={promptOnce.current}
      aiRuntime={proAiRuntime}
      chatPersistence={chatPersistence}
      accountControl={<div className="lm-editor-navigation">
        <button type="button" className="lm-icon-button-sm" title={t.workspace.toggleSidebarTitle} aria-label={t.workspace.toggleSidebarAria} aria-controls="lm-workspace-sidebar" onClick={onToggleSidebar}>
          <PanelLeft size={15}/>
        </button>
        <span className="lm-editor-map-title" title={map.title}>{map.title}</span>
        <PeerPresenceStrip peers={remotePeers} label={t.editorWorkspace.onlinePeers} />
        <button type="button" className="lm-editor-nav-btn" onClick={() => setHistoryOpen(true)} title={t.editorWorkspace.historyBtn}>
          <History size={12}/> <span className="max-sm:sr-only">{t.editorWorkspace.historyBtn}</span>
        </button>
        {map.access === "owner" && (
          <button type="button" className="lm-editor-nav-btn" onClick={onShare} title={t.editorWorkspace.shareBtn}>
            <Share2 size={12}/> <span className="max-sm:sr-only">{t.editorWorkspace.shareBtn}</span>
          </button>
        )}
        <AccountControl
          user={session.user}
          onSessionChange={(next) => { changeSession(next); if (!next.user) navigate("/", true); }}
          sync={sync}
          onSync={(useCloud) => void workspace.current?.sync(useCloud)}
          onKeepLocal={() => void workspace.current?.resolveConflictKeepLocal()}
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
  const [historyTitle, setHistoryTitle] = useState<string | null>(null);
  const chatPersistence = useMemo(
    () => createMapAiChatPersistence(owner, map.id, true),
    [owner, map.id],
  );
  return <ReadOnlyMap id={map.id} access={{ owner }} theme={theme} chatPersistence={chatPersistence} listError={listError}
    navigation={(title) => <>
        <button type="button" className="lm-icon-button-sm" title={t.workspace.toggleSidebarTitle} aria-label={t.workspace.toggleSidebarAria} aria-controls="lm-workspace-sidebar" onClick={onToggleSidebar}>
          <PanelLeft size={15}/>
        </button>
        <span className="lm-editor-map-title" title={title}>{title}</span>
        <button type="button" className="lm-editor-nav-btn" onClick={() => setHistoryTitle(title)} title={t.editorWorkspace.historyBtn}>
          <History size={12}/> <span className="max-sm:sr-only">{t.editorWorkspace.historyBtn}</span>
        </button>
      </>}>
    <VersionHistoryDialog
      open={historyTitle !== null}
      owner={owner}
      mapId={map.id}
      mapTitle={historyTitle ?? map.title}
      readOnly
      onClose={() => setHistoryTitle(null)}
    />
  </ReadOnlyMap>;
}
