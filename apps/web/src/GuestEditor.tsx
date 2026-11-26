import { useCallback, useEffect, useRef, useState } from "react";
import type { MindmapDocument } from "@mindmap/core";
import { MindmapEditor } from "@mindmap/editor";
import { DraftWorkspace } from "./drafts/workspace.js";
import { AppLink } from "./navigation.js";
import { Brand, ThemeToggle, type UiTheme } from "./ui.js";

type ThemeControls = { theme: UiTheme; toggleTheme: () => void };

export function GuestEditor({ theme, toggleTheme }: ThemeControls) {
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
  return <div className="lm-editor-host" style={{ height: "100dvh" }}>
    {error && <div className="lm-editor-error" role="alert">{error}</div>}
    <MindmapEditor
      key={initial.key}
      initialDoc={initial.document}
      onDocumentChange={edit}
      chromeTheme={theme}
      initialFormatPanelOpen={false}
      accountControl={<div className="lm-editor-navigation">
        <Brand to="/" compact />
        <AppLink href="/login" className="lm-secondary-button" style={{ height: 26, fontSize: 11.5, padding: "0 8px" }}>登录保存</AppLink>
        <ThemeToggle theme={theme} toggle={toggleTheme} />
      </div>}
    />
  </div>;
}
