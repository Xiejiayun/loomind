import { useMemo, useState } from "react";
import { FilePlus2, GitBranch, MoveRight, Search, Share2, Trash2 } from "lucide-react";
import { getIntlLocale, getLocale, type Locale } from "@mindmap/core";
import type { WorkspaceSummary } from "./api.js";
import type { MindmapSummary } from "./drafts/shared.js";
import { getWebMessages, useI18n } from "./i18n.js";
import { AppLink } from "./navigation.js";

export function formatRelativeTime(value: string, locale: Locale = getLocale()) {
  const t = getWebMessages(locale).library;
  if (!value) return t.localOnly;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return t.recent;
  const diffMs = Date.now() - date.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return t.justNow;
  if (diffMin < 60) return t.minutesAgo(diffMin);
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return t.hoursAgo(diffHr);
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return t.daysAgo(diffDay);
  return new Intl.DateTimeFormat(getIntlLocale(locale), { month: "short", day: "numeric" }).format(date);
}

export function LibraryView({ maps, workspaces, initialFilter = "all", onShare, onMove, onDelete }: {
  maps: MindmapSummary[];
  workspaces: WorkspaceSummary[];
  initialFilter?: string;
  onShare: (map: MindmapSummary) => void;
  onMove: (map: MindmapSummary, workspaceId: string) => Promise<void>;
  onDelete: (map: MindmapSummary) => Promise<void>;
}) {
  const { locale, t } = useI18n();
  const intlLocale = getIntlLocale(locale);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState(initialFilter);
  const [sort, setSort] = useState<"recent" | "title">("recent");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");

  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase(intlLocale);
    const items = maps.filter((map) => {
      const matchFilter =
        filter === "all"
          ? true
          : filter === "personal"
            ? !map.workspaceId && map.access === "owner"
            : filter === "shared"
              ? map.access !== "owner"
              : map.workspaceId === filter;
      return matchFilter && (!needle || map.title.toLocaleLowerCase(intlLocale).includes(needle));
    });
    return [...items].sort((a, b) =>
      sort === "title"
        ? a.title.localeCompare(b.title, intlLocale)
        : (b.updatedAt || "").localeCompare(a.updatedAt || ""),
    );
  }, [maps, query, filter, sort, intlLocale]);

  async function perform(map: MindmapSummary, action: () => Promise<void>) {
    setBusyId(map.id);
    setError("");
    try { await action(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : t.library.actionFailed); }
    finally { setBusyId(null); }
  }

  return <div className="lm-content-wide">
    <div className="lm-library-header">
      <h1>{t.library.title}<span>{visible.length}</span></h1>
      <AppLink href="/app" className="lm-primary-button"><FilePlus2 size={14}/> {t.library.newMap}</AppLink>
    </div>

    <div className="lm-library-toolbar">
      <div className="lm-filter-pills" role="group" aria-label={t.library.filterAria}>
        <button type="button" className="lm-filter-pill" aria-pressed={filter === "all"} onClick={() => setFilter("all")}>{t.library.filterAll}</button>
        <button type="button" className="lm-filter-pill" aria-pressed={filter === "personal"} onClick={() => setFilter("personal")}>{t.library.filterPersonal}</button>
        <button type="button" className="lm-filter-pill" aria-pressed={filter === "shared"} onClick={() => setFilter("shared")}>{t.library.filterShared}</button>
        {workspaces.map((space) => (
          <button key={space.id} type="button" className="lm-filter-pill" aria-pressed={filter === space.id} onClick={() => setFilter(space.id)}>
            {space.name}
          </button>
        ))}
      </div>

      <div className="lm-library-right-controls">
        <label className="lm-library-search">
          <Search size={14}/>
          <input id="lm-library-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t.library.searchPlaceholder} aria-label={t.library.searchAria}/>
        </label>
        <button
          type="button"
          className="lm-secondary-button"
          style={{ height: 28, fontSize: 12 }}
          onClick={() => setSort((s) => (s === "recent" ? "title" : "recent"))}
          title={t.library.sortTitle}
        >
          {sort === "recent" ? t.library.sortRecent : t.library.sortByName}
        </button>
      </div>
    </div>

    {error && <p className="lm-form-error" role="alert">{error}</p>}

    <div className="lm-library-list" role="list" aria-label={t.library.listAria}>
      {visible.map((map) => {
        const spaceName = workspaces.find((space) => space.id === map.workspaceId)?.name ?? t.common.myMaps;
        const moveTargets = workspaces.filter((space) => space.role !== "viewer" && space.id !== map.workspaceId);
        return <div key={map.id} className="lm-library-row" role="listitem">
          <span className="lm-map-icon" aria-hidden="true"><GitBranch size={14}/></span>
          <AppLink href={`/app/mindmaps/${map.id}`} className="lm-library-title">{map.title}</AppLink>
          <div className="lm-library-meta">
            <span className="lm-space-pill">{spaceName}</span>
            {map.access !== "owner" && <span className="lm-access-tag">{map.access === "viewer" ? t.common.readOnly : t.common.canEdit}</span>}
            <span>{formatRelativeTime(map.updatedAt, locale)}</span>
          </div>
          <div className="lm-library-actions">
            {map.access === "owner" && <>
              <button type="button" title={t.library.shareTitle} aria-label={t.library.shareAria(map.title)} onClick={() => onShare(map)}><Share2 size={14}/></button>
              {!!moveTargets.length && (
                <label className="lm-move-select" title={t.library.moveTitle}>
                  <MoveRight size={14}/>
                  <select
                    aria-label={t.library.moveAria(map.title)}
                    value=""
                    disabled={busyId === map.id}
                    onChange={(event) => { if (event.target.value) void perform(map, () => onMove(map, event.target.value)); }}
                  >
                    <option value="">{t.library.movePlaceholder}</option>
                    {moveTargets.map((space) => <option key={space.id} value={space.id}>{space.name}</option>)}
                  </select>
                </label>
              )}
              <button
                type="button"
                title={t.library.deleteTitle}
                aria-label={t.library.deleteAria(map.title)}
                disabled={busyId === map.id}
                onClick={() => { if (window.confirm(t.library.deleteConfirm(map.title))) void perform(map, () => onDelete(map)); }}
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
          <h2>{maps.length ? t.library.emptyFilteredTitle : t.library.emptyTitle}</h2>
          <p>{maps.length ? t.library.emptyFilteredDesc : t.library.emptyDesc}</p>
          {maps.length
            ? <button type="button" className="lm-secondary-button" onClick={() => { setQuery(""); setFilter("all"); }}>{t.library.clearFilter}</button>
            : <AppLink href="/app" className="lm-primary-button">{t.library.startCreating}</AppLink>}
        </div>
      )}
    </div>
  </div>;
}
