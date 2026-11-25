import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, ChevronLeft, Share2 } from "lucide-react";
import { LocalImmerSyncAdapter, type MindmapDocument, type SyncAdapter } from "@mindmap/core";
import { MindmapEditor } from "@mindmap/editor";
import { AccountControl } from "./auth/AccountControl.js";
import type { Session } from "./auth/shared.js";
import { readCloud } from "./drafts/cloud.js";
import { mapTitle, type MindmapSummary } from "./drafts/shared.js";
import { DraftWorkspace, type SyncState } from "./drafts/workspace.js";
import { AppLink, navigate } from "./navigation.js";

function errorText(reason: unknown, fallback: string) {
  return reason instanceof Error ? reason.message : fallback;
}

export function EditorWorkspace({ map, owner, session, changeSession, onRename, onShare, listError }: {
  map: MindmapSummary;
  owner: string;
  session: Session;
  changeSession: (session: Session) => void;
  onRename: (id: string, title: string) => void;
  onShare: () => void;
  listError: string;
}) {
  if (map.access === "viewer") return <ViewerEditor map={map} owner={owner} listError={listError}/>;
  return <EditableEditor map={map} owner={owner} session={session} changeSession={changeSession} onRename={onRename} onShare={onShare} listError={listError}/>;
}

function EditableEditor({ map, owner, session, changeSession, onRename, onShare, listError }: {
  map: MindmapSummary;
  owner: string;
  session: Session;
  changeSession: (session: Session) => void;
  onRename: (id: string, title: string) => void;
  onShare: () => void;
  listError: string;
}) {
  const [initial, setInitial] = useState<{ document: MindmapDocument; key: number }>();
  const [sync, setSync] = useState<SyncState>({ label: "待连接", detail: "正在检查云端导图。" });
  const [localError, setLocalError] = useState("");
  const workspace = useRef<DraftWorkspace | null>(null);
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
  if (!initial) return <div className="lm-loading">正在打开导图…</div>;
  return <div className="lm-editor-host">
    {(localError || listError) && <div className="lm-editor-error" role="alert">{localError || listError}</div>}
    <MindmapEditor key={initial.key} initialDoc={initial.document} onDocumentChange={edit}
      accountControl={<div className="lm-editor-navigation">
        <button type="button" className="lm-editor-back" onClick={() => { void workspace.current?.flush(); navigate("/app"); }}><ChevronLeft size={15}/> 工作区</button>
        <span className="lm-editor-map-title" title={map.title}>{map.title}</span>
        {map.access === "owner" && <button type="button" className="lm-editor-share" onClick={onShare}><Share2 size={14}/> 共享</button>}
        <AccountControl user={session.user} onSessionChange={(next) => { changeSession(next); if (!next.user) navigate("/", true); }}
          sync={sync} onSync={(useCloud) => void workspace.current?.sync(useCloud)} onLogin={() => navigate("/login")}/>
      </div>}/>
  </div>;
}

function ViewerEditor({ map, owner, listError }: { map: MindmapSummary; owner: string; listError: string }) {
  const [document, setDocument] = useState<MindmapDocument | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    void readCloud(owner, map.id).then((draft) => {
      if (!active) return;
      if (!draft.document) { setError("这张导图暂时无法访问。"); return; }
      setDocument(draft.document);
    }).catch((reason) => { if (active) setError(errorText(reason, "无法读取共享导图。")); });
    return () => { active = false; };
  }, [owner, map.id]);
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
  if (error) return <div className="lm-not-found"><span className="lm-eyebrow">READ ONLY / UNAVAILABLE</span><h1>无法打开共享导图</h1><p role="alert">{error}</p><AppLink href="/app" className="lm-primary-button">返回工作区 <ArrowRight size={16}/></AppLink></div>;
  if (!adapter) return <div className="lm-loading">正在读取共享导图…</div>;
  return <div className="lm-editor-host lm-viewer-editor">
    {listError && <div className="lm-editor-error" role="alert">{listError}</div>}
    <span className="lm-readonly-badge">只读共享 · 修改不会保存</span>
    <MindmapEditor adapter={adapter} accountControl={<div className="lm-editor-navigation">
      <button type="button" className="lm-editor-back" onClick={() => navigate("/app")}><ChevronLeft size={15}/> 工作区</button>
      <span className="lm-editor-map-title" title={map.title}>{map.title}</span><span className="lm-editor-viewer-label">只读</span>
    </div>}/>
  </div>;
}
