import { useCallback, useEffect, useRef, useState } from "react";
import type { MindmapDocument } from "@mindmap/core";
import { GitBranch, ListTree } from "lucide-react";
import { MindmapEditor, useMindmapStore } from "@mindmap/editor";
import { DraftWorkspace } from "./drafts/workspace.js";
import { ThemeToggle, type UiTheme } from "./ui.js";

type ThemeControls = { theme: UiTheme; toggleTheme: () => void };

function GuestSidebar({ theme, toggleTheme }: ThemeControls) {
  const mode = useMindmapStore((state) => state.viewMode);
  const setMode = useMindmapStore((state) => state.setViewMode);
  const zen = useMindmapStore((state) => state.zenMode);
  if (zen) return null;
  return <aside className="lm-sidebar lm-guest-rail" aria-label="编辑器侧栏">
    <div className="lm-sidebar-brand"><strong>loomind</strong></div>
    <nav className="lm-sidebar-top" aria-label="视图导航"><p className="lm-sidebar-section-title">工作区</p>
      {([{ id: "canvas", label: "导图", Icon: GitBranch }, { id: "outline", label: "大纲", Icon: ListTree }] as const).map(({ id, label, Icon }) =>
        <button key={id} type="button" className="lm-recent-link" aria-label={label} title={label} aria-pressed={mode === id} onClick={() => setMode(id)}><Icon size={16}/><span>{label}</span></button>)}
    </nav>
    <div className="lm-sidebar-bottom"><ThemeToggle theme={theme} toggle={toggleTheme}/></div>
  </aside>;
}

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
  return <div className="lm-app-shell lm-guest-editor">
    {error && <div className="lm-editor-error" role="alert">{error}</div>}
    <MindmapEditor key={initial.key} initialDoc={initial.document} onDocumentChange={edit} chromeTheme={theme} initialFormatPanelOpen={false}
      sidebar={<GuestSidebar theme={theme} toggleTheme={toggleTheme}/>}/>
  </div>;
}
