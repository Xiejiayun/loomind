import { useEffect, useRef, useState } from "react";
import { Download, History, RotateCcw, X } from "lucide-react";
import { collectAllTopics, getIntlLocale, type MindmapDocument } from "@mindmap/core";
import {
  listRevisions,
  readRevision,
  type MindmapRevisionSnapshot,
  type MindmapRevisionSummary,
} from "./drafts/cloud.js";
import { useI18n } from "./i18n.js";
import { MapThumbnail } from "./MapThumbnail.js";

function countDocumentTopics(doc: MindmapDocument): number {
  return doc.sheets.reduce((sum, s) => sum + collectAllTopics(s).size, 0);
}

export function VersionHistoryDialog({
  open,
  owner,
  mapId,
  mapTitle,
  readOnly = false,
  onRestore,
  onClose,
}: {
  open: boolean;
  owner: string;
  mapId: string;
  mapTitle: string;
  readOnly?: boolean;
  onRestore?: (doc: MindmapDocument) => void;
  onClose: () => void;
}) {
  const { locale, t } = useI18n();
  const dialog = useRef<HTMLDialogElement>(null);
  const [revisions, setRevisions] = useState<MindmapRevisionSummary[]>([]);
  const [selectedRev, setSelectedRev] = useState<number | null>(null);
  const [snapshot, setSnapshot] = useState<MindmapRevisionSnapshot | null>(null);
  const [loadingList, setLoadingList] = useState(false);
  const [loadingSnap, setLoadingSnap] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) {
      dialog.current?.close();
      return;
    }
    dialog.current?.showModal();
    let active = true;
    setError("");
    setRevisions([]);
    setSelectedRev(null);
    setSnapshot(null);
    setLoadingList(true);
    void listRevisions(owner, mapId)
      .then((list) => {
        if (!active) return;
        setRevisions(list);
        if (list.length > 0) setSelectedRev(list[0].revision);
      })
      .catch((reason) => {
        if (active) setError(reason instanceof Error ? reason.message : t.historyDialog.listError);
      })
      .finally(() => {
        if (active) setLoadingList(false);
      });
    return () => { active = false; };
  }, [open, owner, mapId, t.historyDialog.listError]);

  useEffect(() => {
    if (!open || selectedRev === null) return;
    let active = true;
    setLoadingSnap(true);
    setError("");
    void readRevision(owner, mapId, selectedRev)
      .then((snap) => {
        if (active) setSnapshot(snap);
      })
      .catch((reason) => {
        if (active) setError(reason instanceof Error ? reason.message : t.historyDialog.readError);
      })
      .finally(() => {
        if (active) setLoadingSnap(false);
      });
    return () => { active = false; };
  }, [open, owner, mapId, selectedRev, t.historyDialog.readError]);

  const handleDownload = () => {
    if (!snapshot) return;
    const blob = new Blob([JSON.stringify(snapshot.document, null, 2)], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `loomind-${mapId}-v${snapshot.revision}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleRestore = () => {
    if (!snapshot || readOnly || !onRestore) return;
    if (!window.confirm(t.historyDialog.restoreConfirm(snapshot.revision))) return;
    onRestore(snapshot.document);
    dialog.current?.close();
  };

  const fmtTime = (iso: string) => {
    try {
      return new Date(iso).toLocaleString(getIntlLocale(locale), {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return iso;
    }
  };

  return (
    <dialog ref={dialog} className="lm-modal lm-history-modal" aria-labelledby="lm-history-title" onClose={onClose}>
      {open && (
        <div className="lm-modal-inner">
          <div className="lm-modal-heading">
            <div>
              <span className="lm-eyebrow">VERSION HISTORY</span>
              <h2 id="lm-history-title">{t.historyDialog.title}</h2>
            </div>
            <button
              type="button"
              className="lm-icon-button-sm"
              aria-label={t.common.close}
              onClick={() => dialog.current?.close()}
            >
              <X size={15} />
            </button>
          </div>
          <p className="lm-modal-description">{t.historyDialog.desc(mapTitle)}</p>

          {error && <p className="lm-form-error" role="alert">{error}</p>}

          <div className="lm-history-grid">
            <div className="lm-history-list" role="listbox" aria-label={t.historyDialog.listAria}>
              {loadingList ? (
                <p className="lm-muted">{t.historyDialog.loading}</p>
              ) : revisions.length === 0 ? (
                <p className="lm-muted">{t.historyDialog.empty}</p>
              ) : (
                revisions.map((item, idx) => (
                  <button
                    key={item.revision}
                    type="button"
                    role="option"
                    aria-selected={selectedRev === item.revision}
                    className={`lm-history-item ${selectedRev === item.revision ? "is-selected" : ""}`}
                    onClick={() => setSelectedRev(item.revision)}
                  >
                    <div className="lm-history-item-top">
                      <strong>v{item.revision}</strong>
                      {idx === 0 && <span className="lm-history-current">{t.historyDialog.latestBadge}</span>}
                    </div>
                    <span className="lm-history-item-title">{item.title}</span>
                    <small>{fmtTime(item.createdAt)}</small>
                  </button>
                ))
              )}
            </div>

            <div className="lm-history-preview">
              {loadingSnap ? (
                <div className="lm-history-preview-empty">
                  <History size={20} />
                  <span>{t.historyDialog.loadingPreview}</span>
                </div>
              ) : snapshot ? (
                <>
                  <div className="lm-history-thumb">
                    <MapThumbnail doc={snapshot.document} title={snapshot.title} mapId={`${mapId}-v${snapshot.revision}`} />
                  </div>
                  <div className="lm-history-meta">
                    <strong>v{snapshot.revision} · {snapshot.title}</strong>
                    <span>
                      {t.historyDialog.stats(snapshot.document.sheets.length, countDocumentTopics(snapshot.document))}
                    </span>
                    <small>{fmtTime(snapshot.createdAt)}</small>
                  </div>
                  <div className="lm-history-actions">
                    <button type="button" className="lm-secondary-button" onClick={handleDownload}>
                      <Download size={14} /> {t.historyDialog.downloadBtn}
                    </button>
                    {!readOnly && onRestore && (
                      <button type="button" className="lm-primary-button" onClick={handleRestore}>
                        <RotateCcw size={14} /> {t.historyDialog.restoreBtn}
                      </button>
                    )}
                  </div>
                </>
              ) : (
                <div className="lm-history-preview-empty">
                  <History size={20} />
                  <span>{t.historyDialog.selectHint}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </dialog>
  );
}
