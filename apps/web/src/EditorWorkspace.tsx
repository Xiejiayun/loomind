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
import { NodeReview } from "./NodeReview.js";
import { createMapAiChatPersistence } from "./drafts/ai-chat.js";
import { LiveDraft } from "./drafts/live-draft.js";
import { mapTitle, type MindmapSummary } from "./drafts/shared.js";
import { DEFAULT_STORAGE, DraftWorkspace, type SyncState } from "./drafts/workspace.js";
import { getWebMessages, useI18n } from "./i18n.js";
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

function errorText(reason: unknown, fallback: string) {
  return reason instanceof Error ? reason.message : fallback;
}

export function EditorWorkspace({ map, owner, session, changeSession, theme, initialAiPrompt, onConsumeAiPrompt, onToggleSidebar, onRename, onRecoveredMap, onShare, listError }: {
  map: MindmapSummary;
  owner: string;
  session: Session;
  changeSession: (session: Session) => void;
  theme: UiTheme;
  initialAiPrompt?: string;
  onConsumeAiPrompt?: () => void;
  onToggleSidebar: () => void;
  onRename: (id: string, title: string) => void;
  onRecoveredMap: (id: string, title: string) => void;
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
    onRecoveredMap={onRecoveredMap}
    onShare={onShare}
    listError={listError}
  />;
}

function EditableEditor({ map, owner, session, changeSession, theme, initialAiPrompt, onConsumeAiPrompt, onToggleSidebar, onRename, onRecoveredMap, onShare, listError }: {
  map: MindmapSummary;
  owner: string;
  session: Session;
  changeSession: (session: Session) => void;
  theme: UiTheme;
  initialAiPrompt?: string;
  onConsumeAiPrompt?: () => void;
  onToggleSidebar: () => void;
  onRename: (id: string, title: string) => void;
  onRecoveredMap: (id: string, title: string) => void;
  onShare: () => void;
  listError: string;
}) {
  const { t } = useI18n();
  const proAiRuntime = useWebAiRuntime("pro");
  const [initial, setInitial] = useState<{ adapter: SyncAdapter; key: number }>();
  const [loroReady, setLoroReady] = useState<{ ctor: typeof LoroSyncAdapter | null; loaded: boolean }>({ ctor: null, loaded: false });
  const [remotePeers, setRemotePeers] = useState<PeerPresence[]>([]);
  const [sync, setSync] = useState<SyncState>(() => ({ label: t.sync.connectingLabel, detail: t.sync.connectingDetail, status: "connecting" }));
  const [localError, setLocalError] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const workspace = useRef<DraftWorkspace | null>(null);
  const liveRef = useRef<LiveDraft | null>(null);
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

  const displayName = session.user?.email.split("@")[0] || "Collaborator";
  useEffect(() => {
    if (!loroReady.loaded) return;
    const open = (adapter: SyncAdapter) => setInitial((old) => ({ adapter, key: (old?.key ?? 0) + 1 }));
    const live: LiveDraft | null = loroReady.ctor ? new LiveDraft(loroReady.ctor, owner, map.id, displayName, {
      open, peers: setRemotePeers, refresh: () => current.refreshLive(), change: (doc, remote) => {
        if (remote) current.acceptRemoteDocument(doc); else current.edit(doc);
        onRename(map.id, mapTitle(doc));
      },
    }) : null;
    const current: DraftWorkspace = new DraftWorkspace(owner, map.id,
      live?.show ?? ((doc) => open(new LocalImmerSyncAdapter(doc))), setSync, setLocalError,
      live ? { ...DEFAULT_STORAGE, readCloud: live.read, writeCloud: live.write, mergeLive: live.merge, keepLiveLocal: live.keepLocal, captureHistory: live.captureHistory }
        : { ...DEFAULT_STORAGE, writeCloud: async () => { throw new Error(getWebMessages().editorWorkspace.liveUnavailable); } },
      map.workspaceId, map.access);
    liveRef.current = live;
    workspace.current = current;
    void current.start();
    const flush = () => void current.flush();
    const syncOnline = () => void current.sync();
    window.addEventListener("pagehide", flush);
    window.addEventListener("online", syncOnline);
    return () => {
      live?.close();
      liveRef.current = null;
      current.close();
      workspace.current = null;
      window.removeEventListener("pagehide", flush);
      window.removeEventListener("online", syncOnline);
    };
  }, [owner, map.id, map.workspaceId, map.access, displayName, loroReady, onRename]);

  const edit = useCallback((document: MindmapDocument) => {
    workspace.current?.edit(document);
    onRename(map.id, mapTitle(document));
  }, [map.id, onRename]);

  const restoreRevision = useCallback((document: MindmapDocument) => {
    initial?.adapter.replaceDocument(document);
  }, [initial]);

  const editorAdapter = initial?.adapter;

  const handleSelectionChange = useCallback((topicIds: string[]) => {
    liveRef.current?.session?.setLocalSelection(topicIds);
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
    {!loroReady.ctor && <div className="lm-editor-error" role="status">{t.editorWorkspace.liveUnavailable}</div>}
    {(localError || listError) && <div className="lm-editor-error" role="alert">{localError || listError}</div>}
    <MindmapEditor
      key={initial.key}
      adapter={editorAdapter}
      onDocumentChange={loroReady.ctor ? undefined : edit}
      remotePeers={remotePeers}
      onSelectionChange={handleSelectionChange}
      chromeTheme={theme}
      initialFormatPanelOpen={false}
      initialAiPrompt={promptOnce.current}
      aiRuntime={proAiRuntime}
      chatPersistence={chatPersistence}
      accountControl={<div className="lm-editor-navigation">
        <button type="button" className="lm-icon-button-sm lm-editor-sidebar-toggle" title={t.workspace.toggleSidebarTitle} aria-label={t.workspace.toggleSidebarAria} aria-controls="lm-workspace-sidebar" onClick={onToggleSidebar}>
          <PanelLeft size={15}/>
        </button>
        <span className="lm-editor-map-title" title={map.title}>{map.title}</span>
        <PeerPresenceStrip peers={remotePeers} label={t.editorWorkspace.onlinePeers} />
        {session.user && <NodeReview key={`${owner}:${map.id}`} owner={owner} mapId={map.id}/>}
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
          onSaveAsNew={() => {
            const source = workspace.current;
            const title = mapTitle(editorAdapter.getDocument());
            void source?.saveAsNewMap().then((id) => {
              if (id && workspace.current === source) onRecoveredMap(id, title);
            }).catch((reason) => { if (workspace.current === source) setLocalError(errorText(reason, t.sync.localSaveError)); });
          }}
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
        <button type="button" className="lm-icon-button-sm lm-editor-sidebar-toggle" title={t.workspace.toggleSidebarTitle} aria-label={t.workspace.toggleSidebarAria} aria-controls="lm-workspace-sidebar" onClick={onToggleSidebar}>
          <PanelLeft size={15}/>
        </button>
        <span className="lm-editor-map-title" title={title}>{title}</span>
        <NodeReview key={`${owner}:${map.id}`} owner={owner} mapId={map.id}/>
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
