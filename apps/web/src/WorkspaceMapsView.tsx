import { useMemo, useState } from "react";
import { BookCopy, FilePlus2, GitBranch, MoveRight, Search, Share2, Trash2, Users } from "lucide-react";
import { getIntlLocale, getLocale, type Locale } from "@mindmap/core";
import { saveTeamTemplate, type WorkspaceSummary } from "./api.js";
import type { MindmapSummary } from "./drafts/shared.js";
import { getWebMessages, useI18n } from "./i18n.js";
import { AppLink } from "./navigation.js";
import { TeamTemplates, type OpenTemplateCopy } from "./TeamTemplates.js";
import { SHARED, spacePath, type WorkspaceGroup } from "./workspace-groups.js";

export function formatRelativeTime(value: string, locale: Locale = getLocale()) {
  const t = getWebMessages(locale).mapList;
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

export function WorkspaceMapsView({ group, workspaces, onShare, onMove, onDelete, onTemplateCopy }: {
  group: WorkspaceGroup;
  workspaces: WorkspaceSummary[];
  onShare: (map: MindmapSummary) => void;
  onMove: (map: MindmapSummary, workspaceId: string) => Promise<void>;
  onDelete: (map: MindmapSummary) => Promise<void>;
  onTemplateCopy: OpenTemplateCopy;
}) {
  const { locale, t } = useI18n();
  const intlLocale = getIntlLocale(locale);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"recent" | "title">("recent");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [templateVersion, setTemplateVersion] = useState(0);
  const space = group.workspace;

  const needle = query.trim().toLocaleLowerCase(intlLocale);
  const children = group.children.filter((child) => child.name.toLocaleLowerCase(intlLocale).includes(needle));
  const canCreate = group.id !== SHARED && group.workspace?.role !== "viewer";
  const visible = useMemo(() => {
    const items = group.maps.filter((map) => map.title.toLocaleLowerCase(intlLocale).includes(needle));
    return items.sort((a, b) =>
      sort === "title"
        ? a.title.localeCompare(b.title, intlLocale)
        : (b.updatedAt || "").localeCompare(a.updatedAt || ""),
    );
  }, [group.maps, needle, sort, intlLocale]);

  async function perform(map: MindmapSummary, action: () => Promise<void>) {
    setBusyId(map.id);
    setNotice("");
    setError("");
    try { await action(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : t.mapList.actionFailed); }
    finally { setBusyId(null); }
  }

  return <div className="lm-content-wide lm-library-page">
    <div className="lm-library-header">
      <h1>{group.name}<span className="lm-library-count">{children.length + visible.length}</span></h1>
      {canCreate && <AppLink href="/app" className="lm-primary-button"><FilePlus2 size={14}/> {t.mapList.newMap}</AppLink>}
    </div>

    <div className="lm-library-toolbar">
      <div className="lm-library-right-controls">
        <label className="lm-library-search">
          <Search size={14}/>
          <input id="lm-library-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t.mapList.searchPlaceholder} aria-label={t.mapList.searchAria}/>
        </label>
        <button
          type="button"
          className="lm-secondary-button"
          style={{ height: 28, fontSize: 12 }}
          onClick={() => setSort((s) => (s === "recent" ? "title" : "recent"))}
          title={t.mapList.sortTitle}
        >
          {sort === "recent" ? t.mapList.sortRecent : t.mapList.sortByName}
        </button>
      </div>
    </div>

    {error && <p className="lm-form-error" role="alert">{error}</p>}

    {notice && <p role="status">{notice}</p>}
    {space && <TeamTemplates key={space.id} space={space} refresh={templateVersion} onCopy={onTemplateCopy}/>}
    {children.length > 0 && <nav className="lm-joined-spaces" aria-label={t.workspace.spacesEyebrow}>
      {children.map((child) => <AppLink key={child.id} href={spacePath(child.id)} className="lm-secondary-button"><Users size={14}/>{child.name}</AppLink>)}
    </nav>}
    <div className="lm-library-list" role="list" aria-label={t.mapList.listAria}>
      {visible.map((map) => {
        const moveTargets = workspaces.filter((space) => space.role !== "viewer" && space.id !== map.workspaceId);
        return <div key={map.id} className="lm-library-row" role="listitem">
          <span className="lm-map-icon" aria-hidden="true"><GitBranch size={14}/></span>
          <AppLink href={`/app/mindmaps/${map.id}`} className="lm-library-title">{map.title}</AppLink>
          <div className="lm-library-meta">
            {map.access !== "owner" && <span className="lm-access-tag">{map.access === "viewer" ? t.common.readOnly : t.common.canEdit}</span>}
            <span>{formatRelativeTime(map.updatedAt, locale)}</span>
          </div>
          <div className="lm-library-actions">
            {space && !map.localOnly && space.role !== "viewer" && map.access !== "viewer" && <button type="button" title={t.mapList.teamSave(map.title)} aria-label={t.mapList.teamSave(map.title)} disabled={busyId === map.id} onClick={() => void perform(map, async () => {
              await saveTeamTemplate(space.id, map.id); setTemplateVersion((value) => value + 1); setNotice(t.mapList.teamSaved(map.title));
            })}><BookCopy size={14}/></button>}
            {map.access === "owner" && <>
              <button type="button" title={t.mapList.shareTitle} aria-label={t.mapList.shareAria(map.title)} onClick={() => onShare(map)}><Share2 size={14}/></button>
              {!!moveTargets.length && (
                <label className="lm-move-select" title={t.mapList.moveTitle}>
                  <MoveRight size={14}/>
                  <select
                    aria-label={t.mapList.moveAria(map.title)}
                    value=""
                    disabled={busyId === map.id}
                    onChange={(event) => { if (event.target.value) void perform(map, () => onMove(map, event.target.value)); }}
                  >
                    <option value="">{t.mapList.movePlaceholder}</option>
                    {moveTargets.map((space) => <option key={space.id} value={space.id}>{space.name}</option>)}
                  </select>
                </label>
              )}
              <button
                type="button"
                title={t.mapList.deleteTitle}
                aria-label={t.mapList.deleteAria(map.title)}
                disabled={busyId === map.id}
                onClick={() => { if (window.confirm(t.mapList.deleteConfirm(map.title))) void perform(map, () => onDelete(map)); }}
              >
                <Trash2 size={14}/>
              </button>
            </>}
          </div>
        </div>;
      })}
      {!visible.length && !children.length && (
        <div className="lm-library-empty">
          <span className="lm-empty-icon"><GitBranch size={18}/></span>
          <h2>{needle ? t.mapList.emptyFilteredTitle : group.id === SHARED ? t.mapList.emptySharedTitle : t.mapList.emptyTitle}</h2>
          {(needle || group.id === SHARED || canCreate) && <p>{needle ? t.mapList.emptyFilteredDesc : group.id === SHARED ? t.mapList.emptyShared : t.mapList.emptyDesc}</p>}
          {needle ? <button type="button" className="lm-secondary-button" onClick={() => setQuery("")}>{t.mapList.clearSearch}</button>
            : canCreate && <AppLink href="/app" className="lm-primary-button">{t.mapList.startCreating}</AppLink>}
        </div>
      )}
    </div>
  </div>;
}
