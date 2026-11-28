import { useEffect, useState } from "react";
import { CopyPlus, Trash2 } from "lucide-react";
import { copyTeamTemplate, listTeamTemplates, removeTeamTemplate, type TeamTemplate, type WorkspaceSummary } from "./api.js";
import { useI18n } from "./i18n.js";

export type OpenTemplateCopy = (id: string, title: string, workspaceId: string) => void;

export function TeamTemplates({ space, refresh, onCopy }: { space: WorkspaceSummary; refresh: number; onCopy: OpenTemplateCopy }) {
  const { t } = useI18n();
  const [items, setItems] = useState<TeamTemplate[]>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setError("");
    listTeamTemplates(space.id).then((list) => { if (active) setItems(list); }, (reason) => {
      if (active) setError(reason instanceof Error ? reason.message : t.mapList.teamError);
    });
    return () => { active = false; };
  }, [space.id, refresh, attempt, t.mapList.teamError]);

  async function act(item: TeamTemplate, remove = false) {
    if (busy || (remove && !window.confirm(t.mapList.teamConfirm(item.title)))) return;
    setBusy(true); setError("");
    try {
      if (remove) {
        await removeTeamTemplate(space.id, item.id); setItems((current) => current?.filter((entry) => entry.id !== item.id));
      } else {
        const map = await copyTeamTemplate(space.id, item.id); onCopy(map.id, map.title, map.workspaceId);
      }
    } catch (reason) { setError(reason instanceof Error ? reason.message : t.mapList.teamError); }
    finally { setBusy(false); }
  }

  return <section className="lm-team-templates" aria-label={t.mapList.teamHeading(space.name)}>
    <h2>{t.mapList.teamHeading(space.name)}</h2><p>{t.mapList.teamHint}</p>
    {error && <p role="alert" className="lm-form-error">{error} <button type="button" className="lm-secondary-button" onClick={() => setAttempt((value) => value + 1)}>{t.common.retry}</button></p>}
    {items?.length === 0 && <p>{t.mapList.teamEmpty}</p>}
    {items?.map((item) => <div key={item.id} className="lm-team-template-row"><strong>{item.title}</strong>
      {space.role !== "viewer" && <><button type="button" className="lm-secondary-button" aria-label={t.mapList.teamCopy(item.title)} disabled={busy} onClick={() => void act(item)}><CopyPlus size={15}/>{t.mapList.teamCreate}</button>
        <button type="button" className="lm-secondary-button" title={t.mapList.teamRemove(item.title)} aria-label={t.mapList.teamRemove(item.title)} disabled={busy} onClick={() => void act(item, true)}><Trash2 size={15}/></button></>}
    </div>)}
  </section>;
}
