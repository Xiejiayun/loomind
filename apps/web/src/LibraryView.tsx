import { useMemo, useState } from "react";
import { FilePlus2, GitBranch, MoveRight, Search, Share2, Trash2 } from "lucide-react";
import type { WorkspaceSummary } from "./api.js";
import type { MindmapSummary } from "./drafts/shared.js";
import { AppLink } from "./navigation.js";

export function formatRelativeTime(value: string) {
  if (!value) return "仅本机";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "最近";
  const diffMs = Date.now() - date.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return "刚刚";
  if (diffMin < 60) return `${diffMin} 分钟前`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr} 小时前`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay} 天前`;
  return new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric" }).format(date);
}

export function LibraryView({ maps, workspaces, initialFilter = "all", onShare, onMove, onDelete }: {
  maps: MindmapSummary[];
  workspaces: WorkspaceSummary[];
  initialFilter?: string;
  onShare: (map: MindmapSummary) => void;
  onMove: (map: MindmapSummary, workspaceId: string) => Promise<void>;
  onDelete: (map: MindmapSummary) => Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState(initialFilter);
  const [sort, setSort] = useState<"recent" | "title">("recent");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");

  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("zh-CN");
    const items = maps.filter((map) => {
      const matchFilter =
        filter === "all"
          ? true
          : filter === "personal"
            ? !map.workspaceId && map.access === "owner"
            : filter === "shared"
              ? map.access !== "owner"
              : map.workspaceId === filter;
      return matchFilter && (!needle || map.title.toLocaleLowerCase("zh-CN").includes(needle));
    });
    return [...items].sort((a, b) =>
      sort === "title"
        ? a.title.localeCompare(b.title, "zh-CN")
        : (b.updatedAt || "").localeCompare(a.updatedAt || ""),
    );
  }, [maps, query, filter, sort]);

  async function perform(map: MindmapSummary, action: () => Promise<void>) {
    setBusyId(map.id);
    setError("");
    try { await action(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "操作失败，请重试。"); }
    finally { setBusyId(null); }
  }

  return <div className="lm-content-wide">
    <div className="lm-library-header">
      <h1>全部导图<span>{visible.length}</span></h1>
      <AppLink href="/app" className="lm-primary-button"><FilePlus2 size={14}/> 新建导图</AppLink>
    </div>

    <div className="lm-library-toolbar">
      <div className="lm-filter-pills" role="group" aria-label="空间筛选">
        <button type="button" className="lm-filter-pill" aria-pressed={filter === "all"} onClick={() => setFilter("all")}>全部</button>
        <button type="button" className="lm-filter-pill" aria-pressed={filter === "personal"} onClick={() => setFilter("personal")}>我的导图</button>
        <button type="button" className="lm-filter-pill" aria-pressed={filter === "shared"} onClick={() => setFilter("shared")}>共享给我</button>
        {workspaces.map((space) => (
          <button key={space.id} type="button" className="lm-filter-pill" aria-pressed={filter === space.id} onClick={() => setFilter(space.id)}>
            {space.name}
          </button>
        ))}
      </div>

      <div className="lm-library-right-controls">
        <label className="lm-library-search">
          <Search size={14}/>
          <input id="lm-library-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索导图…" aria-label="搜索导图名称"/>
        </label>
        <button
          type="button"
          className="lm-secondary-button"
          style={{ height: 28, fontSize: 12 }}
          onClick={() => setSort((s) => (s === "recent" ? "title" : "recent"))}
          title="切换排序"
        >
          {sort === "recent" ? "最近编辑" : "按名称"}
        </button>
      </div>
    </div>

    {error && <p className="lm-form-error" role="alert">{error}</p>}

    <div className="lm-library-list" role="list" aria-label="导图列表">
      {visible.map((map) => {
        const spaceName = workspaces.find((space) => space.id === map.workspaceId)?.name ?? "我的导图";
        const moveTargets = workspaces.filter((space) => space.role !== "viewer" && space.id !== map.workspaceId);
        return <div key={map.id} className="lm-library-row" role="listitem">
          <span className="lm-map-icon" aria-hidden="true"><GitBranch size={14}/></span>
          <AppLink href={`/app/mindmaps/${map.id}`} className="lm-library-title">{map.title}</AppLink>
          <div className="lm-library-meta">
            <span className="lm-space-pill">{spaceName}</span>
            {map.access !== "owner" && <span className="lm-access-tag">{map.access === "viewer" ? "只读" : "可编辑"}</span>}
            <span>{formatRelativeTime(map.updatedAt)}</span>
          </div>
          <div className="lm-library-actions">
            {map.access === "owner" && <>
              <button type="button" title="共享导图" aria-label={`共享 ${map.title}`} onClick={() => onShare(map)}><Share2 size={14}/></button>
              {!!moveTargets.length && (
                <label className="lm-move-select" title="移动到工作区">
                  <MoveRight size={14}/>
                  <select
                    aria-label={`移动 ${map.title} 到工作区`}
                    value=""
                    disabled={busyId === map.id}
                    onChange={(event) => { if (event.target.value) void perform(map, () => onMove(map, event.target.value)); }}
                  >
                    <option value="">移动…</option>
                    {moveTargets.map((space) => <option key={space.id} value={space.id}>{space.name}</option>)}
                  </select>
                </label>
              )}
              <button
                type="button"
                title="删除导图"
                aria-label={`删除 ${map.title}`}
                disabled={busyId === map.id}
                onClick={() => { if (window.confirm(`删除「${map.title}」？此操作会同时删除云端和本机副本，无法撤销。`)) void perform(map, () => onDelete(map)); }}
              >
                <Trash2 size={14}/>
              </button>
            </>}
          </div>
        </div>;
      })}
      {!visible.length && (
        <div className="lm-library-empty">
          <span className="lm-empty-icon"><GitBranch size={18}/></span>
          <h2>{maps.length ? "没有匹配的导图" : "还没有导图"}</h2>
          <p>{maps.length ? "试试切换筛选条件或搜索关键词。" : "回到首页输入一个想法，或粘贴大纲立即开始。"}</p>
          {maps.length
            ? <button type="button" className="lm-secondary-button" onClick={() => { setQuery(""); setFilter("all"); }}>清除筛选</button>
            : <AppLink href="/app" className="lm-primary-button">开始创建</AppLink>}
        </div>
      )}
    </div>
  </div>;
}
