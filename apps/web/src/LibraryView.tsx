import { useMemo, useState } from "react";
import { ArrowRight, Clock3, FilePlus2, Map, MoveRight, Search, Share2, Trash2 } from "lucide-react";
import type { WorkspaceSummary } from "./api.js";
import type { MindmapSummary } from "./drafts/shared.js";
import { AppLink } from "./navigation.js";

function editedAt(value: string) {
  if (!value) return "仅保存在本机";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "最近编辑";
  return new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
}

export function LibraryView({ maps, workspaces, onShare, onMove, onDelete }: {
  maps: MindmapSummary[];
  workspaces: WorkspaceSummary[];
  onShare: (map: MindmapSummary) => void;
  onMove: (map: MindmapSummary, workspaceId: string) => Promise<void>;
  onDelete: (map: MindmapSummary) => Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [sort, setSort] = useState("recent");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("zh-CN");
    const items = maps.filter((map) => (filter === "all" || (filter === "personal" ? !map.workspaceId : map.workspaceId === filter)) &&
      (!needle || map.title.toLocaleLowerCase("zh-CN").includes(needle)));
    return [...items].sort((a, b) => sort === "title" ? a.title.localeCompare(b.title, "zh-CN") : (b.updatedAt || "").localeCompare(a.updatedAt || ""));
  }, [maps, query, filter, sort]);

  async function perform(map: MindmapSummary, action: () => Promise<void>) {
    setBusyId(map.id);
    setError("");
    try { await action(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "操作失败，请重试。"); }
    finally { setBusyId(null); }
  }

  return <div className="lm-content lm-library-view">
    <div className="lm-page-heading"><div><span className="lm-eyebrow">LIBRARY / {maps.length} MINDMAPS</span><h1>全部导图</h1><p>搜索、打开和管理你的独立导图，也可以将导图放入共享工作区。</p></div>
      <AppLink href="/app/create" className="lm-primary-button"><FilePlus2 size={16}/> 新建导图</AppLink></div>
    <div className="lm-library-controls"><label className="lm-library-search"><Search size={16}/><input id="lm-library-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索导图名称" aria-label="搜索导图名称"/></label>
      <select aria-label="筛选工作区" value={filter} onChange={(event) => setFilter(event.target.value)}><option value="all">所有空间</option><option value="personal">我的导图</option>{workspaces.map((space) => <option key={space.id} value={space.id}>{space.name}</option>)}</select>
      <select aria-label="排序方式" value={sort} onChange={(event) => setSort(event.target.value)}><option value="recent">最近编辑</option><option value="title">名称排序</option></select>
    </div>
    {error && <p className="lm-form-error" role="alert">{error}</p>}
    <div className="lm-library-list" role="list" aria-label="导图列表">
      {visible.map((map) => {
        const spaceName = workspaces.find((space) => space.id === map.workspaceId)?.name ?? "我的导图";
        const moveTargets = workspaces.filter((space) => space.role !== "viewer" && space.id !== map.workspaceId);
        return <div key={map.id} className="lm-library-row" role="listitem">
          <div className="lm-map-icon" aria-hidden="true"><Map size={19}/></div>
          <div className="lm-library-copy"><AppLink href={`/app/mindmaps/${map.id}`} className="lm-library-title">{map.title}</AppLink>
            <div className="lm-library-meta"><span>{spaceName}</span><span>·</span><Clock3 size={12}/><span>{editedAt(map.updatedAt)}</span>{map.access !== "owner" && <span className="lm-access-tag">{map.access === "viewer" ? "只读共享" : "共享编辑"}</span>}</div></div>
          <div className="lm-library-actions"><AppLink href={`/app/mindmaps/${map.id}`} className="lm-row-open" aria-label={`打开 ${map.title}`}>打开 <ArrowRight size={14}/></AppLink>
            {map.access === "owner" && <><button type="button" title="共享导图" aria-label={`共享 ${map.title}`} onClick={() => onShare(map)}><Share2 size={16}/></button>
              {!!moveTargets.length && <label className="lm-move-select" title="移动到工作区"><MoveRight size={16}/><select aria-label={`移动 ${map.title} 到工作区`} value="" disabled={busyId === map.id}
                onChange={(event) => { if (event.target.value) void perform(map, () => onMove(map, event.target.value)); }}><option value="">移动到…</option>{moveTargets.map((space) => <option key={space.id} value={space.id}>{space.name}</option>)}</select></label>}
              <button type="button" title="删除导图" aria-label={`删除 ${map.title}`} disabled={busyId === map.id}
                onClick={() => { if (window.confirm(`删除「${map.title}」？此操作会同时删除云端和本机副本，无法撤销。`)) void perform(map, () => onDelete(map)); }}><Trash2 size={16}/></button></>}
          </div>
        </div>;
      })}
      {!visible.length && <div className="lm-library-empty"><span className="lm-empty-icon"><Map size={22}/></span><h2>{maps.length ? "没有匹配的导图" : "从第一张导图开始"}</h2>
        <p>{maps.length ? "试试不同的关键词或空间筛选。" : "从一个主题开始，或导入你已经写好的大纲。"}</p>
        {maps.length ? <button type="button" className="lm-secondary-button" onClick={() => { setQuery(""); setFilter("all"); }}>清除筛选</button>
          : <AppLink href="/app/create" className="lm-primary-button">新建导图 <ArrowRight size={16}/></AppLink>}</div>}
    </div>
  </div>;
}
