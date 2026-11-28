import { useEffect, useState, type ReactNode } from "react";
import { LocalImmerSyncAdapter, type MindmapDocument, type SyncAdapter } from "@mindmap/core";
import { MindmapEditor, type AiChatPersistence } from "@mindmap/editor";
import { CloudError, readViewSnapshot, type ViewAccess } from "./drafts/cloud.js";
import { mapTitle } from "./drafts/shared.js";
import { useI18n } from "./i18n.js";
import { AppLink } from "./navigation.js";
import { Brand, type UiTheme } from "./ui.js";

function readOnlySource(doc: MindmapDocument) {
  const source = new LocalImmerSyncAdapter(doc);
  let chosenSheet: string | undefined;
  const adapter: SyncAdapter = {
    getDocument: () => source.getDocument(), subscribe: (listener) => source.subscribe(listener),
    applyCommand(command) {
      if (command.type === "sheet/switch") chosenSheet = command.sheetId;
      if (command.type === "sheet/switch" || command.type === "topic/toggleCollapse") return source.applyCommand(command);
    },
    replaceDocument: () => {}, undo: () => {}, redo: () => {}, canUndo: () => false, canRedo: () => false,
  };
  return { adapter, refresh(next: MindmapDocument) {
    if (chosenSheet && !next.sheets.some((sheet) => sheet.id === chosenSheet)) chosenSheet = undefined;
    source.replaceDocument(chosenSheet ? { ...next, activeSheetId: chosenSheet } : next);
  } };
}

export function ReadOnlyMap({ id, access, theme, navigation, chatPersistence, listError, children }: {
  id: string; access: ViewAccess; theme: UiTheme; navigation?: (title: string) => ReactNode;
  chatPersistence?: AiChatPersistence; listError?: string; children?: ReactNode;
}) {
  const { t } = useI18n();
  const owner = "owner" in access ? access.owner : undefined;
  const token = "token" in access ? access.token : undefined;
  const [view, setView] = useState<{ adapter: SyncAdapter; title: string } | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "retrying" | "unavailable">("loading");
  useEffect(() => {
    const controller = new AbortController();
    let revision = 0;
    let live: ReturnType<typeof readOnlySource> | undefined;
    let timer: number | undefined;
    let pending = false;
    let ended = false;
    async function refresh() {
      window.clearTimeout(timer);
      if (ended || pending || document.hidden) return;
      pending = true;
      try {
        const next = await readViewSnapshot(id, owner !== undefined ? { owner } : { token: token ?? "" }, revision, controller.signal);
        if (ended) return;
        if (next) {
          if (live) live.refresh(next.document);
          else live = readOnlySource(next.document);
          revision = next.revision;
          setView({ adapter: live.adapter, title: mapTitle(next.document) });
        }
        setStatus("ready");
      } catch (reason) {
        if (ended) return;
        if (reason instanceof CloudError && [401, 403, 404].includes(reason.status)) {
          ended = true;
          setView(null);
          setStatus("unavailable");
        } else setStatus("retrying");
      } finally {
        pending = false;
        if (!ended && !document.hidden) timer = window.setTimeout(refresh, 5_000);
      }
    }
    void refresh();
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("online", refresh);
    return () => {
      ended = true;
      controller.abort();
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("online", refresh);
    };
  }, [id, owner, token]);

  if (status === "unavailable") return <div className="lm-not-found"><h1>{t.editorWorkspace.cannotOpenShared}</h1>
    <p role="alert">{t.editorWorkspace.mapUnavailable}</p><AppLink href={owner ? "/app" : "/"} className="lm-primary-button">{owner ? t.notFound.backToWorkspace : t.login.backHome}</AppLink></div>;
  if (!view) return <div className="lm-loading" role="status">{status === "retrying" ? t.editorWorkspace.retrying : t.editorWorkspace.loadingShared}</div>;
  return <div className="lm-editor-host lm-viewer-editor">
    {(status === "retrying" || listError) && <div className="lm-editor-error" role="status">{status === "retrying" ? t.editorWorkspace.retrying : listError}</div>}
    <span className="lm-readonly-badge max-md:sr-only">{t.editorWorkspace.readonlyBanner}</span>
    <MindmapEditor adapter={view.adapter} chromeTheme={theme} readOnly chatPersistence={chatPersistence}
      accountControl={<div className="lm-editor-navigation">{navigation ? navigation(view.title) : <><Brand to="/" compact/><span className="lm-editor-map-title" title={view.title}>{view.title}</span></>}
        <span className="lm-editor-viewer-label">{t.common.readOnly}</span></div>}/>
    {children}
  </div>;
}
