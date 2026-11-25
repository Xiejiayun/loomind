import { useCallback, useEffect, useRef, useState } from "react";
import type { MindmapDocument } from "@mindmap/core";
import { MindmapEditor } from "@mindmap/editor";
import { AccountControl } from "./auth/AccountControl.js";
import { useSession } from "./auth/session.js";
import type { Session } from "./auth/shared.js";
import { getTemplate } from "@mindmap/core";
import { listCloud } from "./drafts/cloud.js";
import { mapTitle, type MindmapSummary } from "./drafts/shared.js";
import { DraftWorkspace, type SyncState } from "./drafts/workspace.js";
import { listLocalMaps, loadLocal, saveLocal } from "./persistence.js";

export function App() {
  const { session, changeSession, sessionError, refresh } = useSession();
  if (!session) return <Loading />;
  return <>
    {sessionError && <div role="alert" className="fixed bottom-14 left-3 z-50 rounded bg-amber-50 px-3 py-2 text-sm text-amber-950">
      {sessionError} <button className="underline" onClick={() => void refresh()}>重试</button>
    </div>}
    <Workspace key={session.user ? `google:${session.user.id}` : "guest"} session={session} changeSession={changeSession} />
  </>;
}

const Loading = () => <div className="flex h-screen w-screen items-center justify-center bg-slate-50 text-sm text-slate-400">正在加载 Loomind…</div>;

function Workspace({ session, changeSession }: { session: Session; changeSession: (next: Session) => void }) {
  const owner = session.user?.id ?? null;
  const [maps, setMaps] = useState<MindmapSummary[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(!!owner);
  const [listError, setListError] = useState("");
  useEffect(() => {
    if (!owner) return;
    let active = true;
    void (async () => {
      try {
        const local = await listLocalMaps(owner);
        const legacy = await loadLocal(owner);
        if (legacy && local.length === 0) {
          const id = crypto.randomUUID();
          await saveLocal(owner, legacy, id);
          local.push({ id, title: mapTitle(legacy.document), updatedAt: "" });
        }
        let remote: MindmapSummary[] = [];
        let remoteUnavailable = false;
        try { remote = await listCloud(owner); }
        catch (error) {
          remoteUnavailable = true;
          if (active) setListError(error instanceof Error ? error.message : "无法读取云端导图列表。");
        }
        if (!active) return;
        const merged = [...remote, ...local.filter((item) => !remote.some((other) => other.id === item.id))];
        if (!merged.length && !remoteUnavailable) {
          const id = crypto.randomUUID();
          const document = getTemplate("blank-organic").create();
          await saveLocal(owner, { document, revision: 0, dirty: true }, id);
          merged.push({ id, title: mapTitle(document), updatedAt: "" });
        }
        if (!active) return;
        setMaps(merged);
        const previous = localStorage.getItem(`loomind:selected:${owner}`);
        setSelected(merged.some((item) => item.id === previous) ? previous : merged[0].id);
      } catch (error) { if (active) setListError(error instanceof Error ? error.message : "本机导图列表无法读取。"); }
      finally { if (active) setLoading(false); }
    })();
    return () => { active = false; };
  }, [owner]);
  const rename = useCallback((id: string, title: string) => {
    setMaps((previous) => previous.map((item) => item.id === id ? { ...item, title } : item));
  }, []);
  const select = useCallback((id: string) => {
    if (!owner || !maps.some((item) => item.id === id)) return;
    localStorage.setItem(`loomind:selected:${owner}`, id);
    setSelected(id);
  }, [owner, maps]);
  const create = useCallback(async () => {
    if (!owner) return;
    const id = crypto.randomUUID();
    const document = getTemplate("blank-organic").create();
    try {
      await saveLocal(owner, { document, revision: 0, dirty: true }, id);
      setMaps((previous) => [{ id, title: mapTitle(document), updatedAt: "" }, ...previous]);
      localStorage.setItem(`loomind:selected:${owner}`, id);
      setSelected(id);
      setListError("");
    } catch { setListError("无法创建本机导图，请检查浏览器存储空间。"); }
  }, [owner]);
  if (loading) return <Loading />;
  if (owner && !selected) return <div role="alert" className="flex h-screen items-center justify-center gap-3 p-6 text-sm">
    {listError || "导图列表暂不可用。"} <button type="button" className="underline" onClick={() => location.reload()}>重试</button>
  </div>;
  return <EditorWorkspace key={selected ?? "guest"} owner={owner} id={selected} session={session} changeSession={changeSession}
    maps={maps} select={select} create={create} listError={listError}
    rename={rename} />;
}

function EditorWorkspace({ owner, id, session, changeSession, maps, select, create, listError, rename }: {
  owner: string | null; id: string | null; session: Session; changeSession: (next: Session) => void;
  maps: MindmapSummary[]; select: (id: string) => void; create: () => void; listError: string; rename: (id: string, title: string) => void;
}) {
  const [initial, setInitial] = useState<{ document: MindmapDocument; key: number }>();
  const [sync, setSync] = useState<SyncState>({ label: "待连接", detail: "正在检查云端导图。" });
  const [localError, setLocalError] = useState("");
  const workspace = useRef<DraftWorkspace | null>(null);
  useEffect(() => {
    const current = new DraftWorkspace(owner, id, (document) => setInitial((old) => ({ document, key: (old?.key ?? 0) + 1 })), setSync, setLocalError);
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
  }, [owner, id]);
  const edit = useCallback((document: MindmapDocument) => {
    workspace.current?.edit(document);
    if (id) rename(id, mapTitle(document));
  }, [id, rename]);
  if (!initial) return <Loading />;
  return <>
    {(localError || listError) && <p role="alert" className="fixed bottom-24 left-3 z-50 rounded bg-red-50 px-3 py-2 text-sm text-red-800">{localError || listError}</p>}
    <MindmapEditor key={initial.key} initialDoc={initial.document} onDocumentChange={edit} accountControl={
      <AccountControl user={session.user} onSessionChange={changeSession} sync={sync} onSync={(useCloud) => void workspace.current?.sync(useCloud)}
        maps={maps} selected={id} onSelect={select} onCreate={() => void create()} />
    } />
  </>;
}
