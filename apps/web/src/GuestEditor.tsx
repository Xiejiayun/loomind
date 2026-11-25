import { useCallback, useEffect, useRef, useState } from "react";
import type { MindmapDocument } from "@mindmap/core";
import { MindmapEditor } from "@mindmap/editor";
import { DraftWorkspace } from "./drafts/workspace.js";
import { navigate } from "./navigation.js";

export function GuestEditor() {
  const [initial, setInitial] = useState<{ document: MindmapDocument; key: number }>();
  const [error, setError] = useState("");
  const workspace = useRef<DraftWorkspace | null>(null);
  useEffect(() => {
    const current = new DraftWorkspace(null, null, (document) => setInitial((old) => ({ document, key: (old?.key ?? 0) + 1 })), () => {}, setError);
    workspace.current = current;
    void current.start();
    const flush = () => void current.flush();
    window.addEventListener("pagehide", flush);
    return () => { current.close(); workspace.current = null; window.removeEventListener("pagehide", flush); };
  }, []);
  const edit = useCallback((document: MindmapDocument) => workspace.current?.edit(document), []);
  if (!initial) return <div className="lm-loading">正在打开编辑器…</div>;
  return <div className="lm-guest-editor">
    {error && <div className="lm-editor-error" role="alert">{error}</div>}
    <MindmapEditor key={initial.key} initialDoc={initial.document} onDocumentChange={edit}
      accountControl={<div className="lm-editor-navigation">
        <button type="button" onClick={() => navigate("/")}>← 首页</button>
        <span className="lm-editor-map-title">游客草稿</span>
        <button type="button" onClick={() => navigate("/login")}>Google 登录</button>
      </div>}/>
  </div>;
}
