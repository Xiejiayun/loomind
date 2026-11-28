import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, ChevronRight, GitBranch, Layers, Share2, Users } from "lucide-react";
import { useI18n } from "./i18n.js";
import { AppLink } from "./navigation.js";
import { orderedGroups, PERSONAL, SHARED, spacePath, type WorkspaceGroup, type WorkspaceSummary } from "./workspace-groups.js";

const MAP_LIMIT = 10;

export function WorkspaceTree({ groups, selected, mapId, onNavigate, onShare }: {
  groups: WorkspaceGroup[]; selected: WorkspaceGroup | undefined; mapId: string | null;
  onNavigate: () => void; onShare: (space: WorkspaceSummary) => void;
}) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const selectedId = selected?.id;
  const nested = !!selected?.workspace && selected.workspace.role !== "owner";
  useEffect(() => {
    if (selectedId) setExpanded((prev) => ({ ...prev, [selectedId]: true, ...(nested && { [SHARED]: true }) }));
  }, [selectedId, nested, mapId]);

  function renderGroup(group: WorkspaceGroup) {
    const { id, name, maps, children, workspace } = group;
    const open = !!expanded[id];
    const current = id === selectedId;
    const count = maps.length + children.length;
    const visible = maps.slice(0, MAP_LIMIT);
    if (current && mapId && maps.length > MAP_LIMIT && !visible.some((map) => map.id === mapId)) {
      const active = maps.find((map) => map.id === mapId);
      if (active) visible[MAP_LIMIT - 1] = active;
    }
    return <div key={id} className="lm-space-group">
      <div className={`lm-space-row ${current ? "is-selected" : ""}`}>
        <button type="button" className={`lm-space-toggle ${open ? "is-expanded" : ""}`} aria-expanded={open}
          aria-label={t.workspace.toggleSpaceMapsAria(name)} onClick={() => setExpanded((prev) => ({ ...prev, [id]: !prev[id] }))}>
          <ChevronRight size={12}/>
        </button>
        <AppLink href={spacePath(id)} className={`lm-space-item ${current ? "is-selected" : ""}`} aria-label={name}
          aria-current={current && !mapId && location.pathname === spacePath(id) ? "page" : undefined}
          onClick={() => { setExpanded((prev) => ({ ...prev, [id]: true })); onNavigate(); }}>
          {id === PERSONAL ? <Layers size={13} className="lm-space-icon"/> : id === SHARED ? <Users size={13} className="lm-space-icon"/>
            : <span className="lm-space-glyph" aria-hidden="true">{name.slice(0, 1).toUpperCase()}</span>}
          <span className="lm-space-name">{name}</span>
          {count > 0 && <span className="lm-space-count">{count}</span>}
          {current && <span className="lm-space-active-dot" aria-hidden="true"/>}
        </AppLink>
        {workspace?.role === "owner" && <button type="button" className="lm-space-share-btn" title={t.workspace.shareSpace}
          aria-label={`${t.workspace.shareSpace}: ${name}`} onClick={() => onShare(workspace)}><Share2 size={12}/></button>}
      </div>
      {open && <div className="lm-space-maps">
        {children.map(renderGroup)}
        {visible.map((map) => <AppLink key={map.id} href={`/app/mindmaps/${map.id}`} title={map.title} onClick={onNavigate}
          className={`lm-space-map-item ${map.id === mapId ? "is-active" : ""}`} aria-current={map.id === mapId ? "page" : undefined}>
          <GitBranch size={12} className="lm-space-map-icon" aria-hidden="true"/><span>{map.title}</span>
        </AppLink>)}
        {maps.length > MAP_LIMIT && <AppLink className="lm-space-map-more" href={spacePath(id)} onClick={onNavigate}>{t.workspace.viewAllInSpace(maps.length)}</AppLink>}
        {!count && <div className="lm-space-maps-empty">{t.workspace.emptySpaceMaps}</div>}
      </div>}
    </div>;
  }
  return <div className="lm-space-list">{groups.map(renderGroup)}</div>;
}

export function WorkspaceOrderDialog({ roots, joined, onSave, onClose }: {
  roots: WorkspaceGroup[]; joined: WorkspaceGroup[]; onSave: (order: string[]) => Promise<void>; onClose: () => void;
}) {
  const { t } = useI18n();
  const dialog = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState(() => [...roots, ...joined].map((group) => group.id));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { dialog.current?.showModal(); }, []);
  const top = orderedGroups(roots, draft);
  const nested = orderedGroups(joined, draft);
  const saved = [...roots, ...joined];
  const current = [...top, ...nested].map((group) => group.id);
  const changed = current.some((id, index) => id !== saved[index].id);
  async function save() {
    setSaving(true);
    setError("");
    try { await onSave(current); dialog.current?.close(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : t.workspace.orderFailed); }
    finally { setSaving(false); }
  }
  function orderingList(groups: WorkspaceGroup[], label: string) {
    return <ol className="lm-order-list" aria-label={label}>{groups.map((group, index) => {
      const move = (offset: number) => {
        const next = [...current];
        const from = next.indexOf(group.id);
        const to = next.indexOf(groups[index + offset].id);
        [next[from], next[to]] = [next[to], next[from]];
        setDraft(next);
      };
      return <li key={group.id}>
        <span className="lm-space-name">{group.name}</span>
        <button type="button" className="lm-icon-button-sm" aria-label={t.workspace.moveUp(group.name)} disabled={saving || index === 0} onClick={() => move(-1)}><ArrowUp size={15}/></button>
        <button type="button" className="lm-icon-button-sm" aria-label={t.workspace.moveDown(group.name)} disabled={saving || index === groups.length - 1} onClick={() => move(1)}><ArrowDown size={15}/></button>
      </li>;
    })}</ol>;
  }
  return <dialog ref={dialog} className="lm-modal" aria-labelledby="lm-order-title" onClose={onClose} onCancel={(event) => { if (saving) event.preventDefault(); }}>
    <div className="lm-modal-inner">
      <div className="lm-modal-heading"><h2 id="lm-order-title">{t.workspace.reorder}</h2></div>
      <p className="lm-modal-description">{t.workspace.orderHint}</p>
      {orderingList(top, t.workspace.spacesEyebrow)}
      {nested.length > 1 && <><h3 className="lm-eyebrow">{t.workspace.navShared}</h3>{orderingList(nested, t.workspace.navShared)}</>}
      {error && <p className="lm-form-error" role="alert">{error}</p>}
      <div className="lm-modal-actions">
        <button type="button" className="lm-secondary-button" disabled={saving} onClick={() => dialog.current?.close()}>{t.common.cancel}</button>
        <button type="button" className="lm-primary-button" disabled={saving || !changed} onClick={() => void save()}>{t.workspace.saveOrder}</button>
      </div>
    </div>
  </dialog>;
}
