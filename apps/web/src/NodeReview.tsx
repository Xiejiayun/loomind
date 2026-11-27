import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MessageSquare, RefreshCw, X } from "lucide-react";
import { collectAllTopics, getIntlLocale, richTextToPlainText } from "@mindmap/core";
import { useMindmapStore, useMindmapStoreApi } from "@mindmap/editor";
import { ApiError, nodeReviewApi } from "./api.js";
import { REVIEW_BODY_LIMIT, type ReviewList, type ReviewDetail, type ReviewMessage, type ReviewThread } from "./drafts/reviews.js";
import { useI18n } from "./i18n.js";

type Target = { owner: string; mapId: string };

export function NodeReview(target: Target) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return <>
    <button type="button" className="lm-editor-nav-btn" title={t.review.title} onClick={() => setOpen(true)}>
      <MessageSquare size={12}/><span className="max-sm:sr-only">{t.review.title}</span>
    </button>
    {open && <ReviewDialog {...target} onClose={() => setOpen(false)}/>}
  </>;
}

function ReviewDialog({ owner, mapId, onClose }: Target & { onClose: () => void }) {
  const { t, locale } = useI18n();
  const msg = t.review;
  const dialog = useRef<HTMLDialogElement>(null);
  const store = useMindmapStoreApi();
  const doc = useMindmapStore((state) => state.doc);
  const selectedIds = useMindmapStore((state) => state.selectedTopicIds);
  const sheets = useMemo(() => new Map(doc.sheets.map((sheet) => [sheet.id, { title: sheet.title, topics: collectAllTopics(sheet) }])), [doc.sheets]);
  const selected = selectedIds.length === 1 ? sheets.get(doc.activeSheetId)?.topics.get(selectedIds[0]) : undefined;
  const api = useMemo(() => nodeReviewApi(owner, mapId), [owner, mapId]);
  const [threadId, setThreadId] = useState<number | null>(null);
  const [version, setVersion] = useState(0);
  const [view, setView] = useState<ReviewList | ReviewDetail | null>(null);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<number | null>(null);
  const thread = view && "thread" in view ? view.thread : null;
  const canPost = view && (view.access !== "viewer" || view.viewersCanComment);
  const statusOf = (reason: unknown) => reason instanceof ApiError ? reason.status : 500;

  useEffect(() => { dialog.current?.showModal(); }, []);
  useEffect(() => {
    let active = true;
    void (threadId === null ? api.list() : api.detail(threadId)).then((result) => {
      if (active) setView(result);
    }).catch((reason) => { if (active) setError(statusOf(reason)); });
    return () => { active = false; };
  }, [api, threadId, version]);

  function refresh() { setError(null); setView(null); setVersion((previous) => previous + 1); }
  function show(id: number | null) { setError(null); setBody(""); setView(null); setThreadId(id); }
  async function act(operation: () => Promise<void>) {
    if (busy) return;
    setBusy(true); setError(null);
    try { await operation(); } catch (reason) { setError(statusOf(reason)); } finally { setBusy(false); }
  }
  async function more() {
    if (!view?.nextCursor) return;
    if ("threads" in view) {
      const next = await api.list(view.nextCursor);
      setView({ ...next, threads: [...view.threads, ...next.threads] });
    } else {
      const next = await api.detail(view.thread.id, view.nextCursor);
      setView({ ...next, replies: [...view.replies, ...next.replies] });
    }
  }
  function location(item: ReviewThread) {
    const sheet = sheets.get(item.sheetId);
    const topic = sheet?.topics.get(item.topicId);
    return sheet && topic ? `${sheet.title} · ${richTextToPlainText(topic.title) || msg.untitled}` : `${item.topicTitle || msg.untitled} · ${msg.removed}`;
  }
  function focus(item: ReviewThread) {
    const state = store.getState();
    if (state.doc.activeSheetId !== item.sheetId) state.dispatch({ type: "sheet/switch", sheetId: item.sheetId });
    state.setViewMode("canvas"); state.setDrillRootId(item.topicId); state.selectTopics([item.topicId]);
    dialog.current?.close();
  }
  function message(item: ReviewMessage) {
    return <><small>{item.author} · <time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleString(getIntlLocale(locale))}</time></small><p>{item.body}</p></>;
  }
  const composer = canPost && (thread ? !thread.resolvedAt : selected) && <form className="lm-review-compose" onSubmit={(event) => {
    event.preventDefault();
    if (!body.trim()) return;
    void act(async () => {
      if (thread) { await api.reply(thread.id, body); setBody(""); refresh(); }
      else if (selected) { const result = await api.create(doc.activeSheetId, selected.id, body); show(result.id); }
    });
  }}>
    <label htmlFor="lm-review-body">{thread ? msg.reply : msg.newComment}</label>
    <textarea id="lm-review-body" value={body} maxLength={REVIEW_BODY_LIMIT} rows={3} disabled={busy} onChange={(event) => setBody(event.target.value)}/>
    <button type="submit" className="lm-primary-button" disabled={busy || !body.trim()}>{thread ? msg.send : msg.start}</button>
  </form>;

  return createPortal(<dialog ref={dialog} className="lm-modal lm-review-dialog" aria-labelledby="lm-review-title" onClose={onClose}
    onKeyDown={(event) => event.stopPropagation()} onCopy={(event) => event.stopPropagation()} onCut={(event) => event.stopPropagation()} onPaste={(event) => event.stopPropagation()}>
    <div className="lm-modal-inner">
      <div className="lm-modal-heading"><h2 id="lm-review-title">{msg.title}</h2><div className="lm-review-actions">
        <button type="button" className="lm-icon-button-sm" aria-label={msg.refresh} disabled={busy || (!view && error === null)} onClick={refresh}><RefreshCw size={15}/></button>
        <button type="button" className="lm-icon-button-sm" aria-label={t.common.close} onClick={() => dialog.current?.close()}><X size={15}/></button>
      </div></div>
      <p className="lm-modal-description">{msg.hint}</p>
      {threadId !== null && <button type="button" className="lm-secondary-button" disabled={busy} onClick={() => show(null)}>{t.common.back}</button>}
      {error !== null && <p className="lm-form-error" role="alert">{error === 409 ? msg.changed : error === 403 || error === 401 ? msg.denied : error === 404 ? msg.missing : msg.failed}</p>}
      {!view && error === null && <p role="status">{msg.loading}</p>}
      {view && !canPost && <p className="lm-modal-description">{msg.readOnly}</p>}
      {view && "threads" in view && <>
        {view.access === "owner" && <label className="lm-review-policy"><input type="checkbox" checked={view.viewersCanComment} disabled={busy}
          onChange={(event) => { const allowed = event.target.checked; void act(async () => { await api.policy(allowed); setView({ ...view, viewersCanComment: allowed }); }); }}/>{msg.policy}</label>}
        {canPost && <p className="lm-review-anchor">{selected ? msg.selected(richTextToPlainText(selected.title) || msg.untitled) : msg.selectOne}</p>}
        {composer}
        <h3>{msg.all}</h3>
        {view.threads.length === 0 && <p className="lm-modal-description">{msg.empty}</p>}
        <ul className="lm-review-threads">{view.threads.map((item) => <li key={item.id}><button type="button" disabled={busy} onClick={() => show(item.id)}>
          <strong>{location(item)}</strong><small>{item.resolvedAt ? msg.resolved : msg.open} · {item.author}</small><span>{item.body}</span>
        </button></li>)}</ul>
      </>}
      {view && "thread" in view && <>
        <h3>{location(view.thread)}</h3><article className="lm-review-message">{message(view.thread)}</article>
        {view.thread.resolvedBy && view.thread.resolvedAt && <p className="lm-review-anchor">{msg.resolvedBy(view.thread.resolvedBy)} · <time dateTime={view.thread.resolvedAt}>{new Date(view.thread.resolvedAt).toLocaleString(getIntlLocale(locale))}</time></p>}
        <div className="lm-review-actions">
          {sheets.get(view.thread.sheetId)?.topics.has(view.thread.topicId) && <button type="button" className="lm-secondary-button" disabled={busy} onClick={() => focus(view.thread)}>{msg.focus}</button>}
          {view.access !== "viewer" && <button type="button" className="lm-secondary-button" disabled={busy} onClick={() => void act(async () => { await api.resolve(view.thread.id, !view.thread.resolvedAt); refresh(); })}>{view.thread.resolvedAt ? msg.reopen : msg.resolve}</button>}
        </div>
        <ol className="lm-review-replies">{[...view.replies].reverse().map((reply) => <li className="lm-review-message" key={reply.id}>{message(reply)}</li>)}</ol>
        {composer}
      </>}
      {view?.nextCursor && <button type="button" className="lm-secondary-button" disabled={busy} onClick={() => void act(more)}>{msg.more}</button>}
    </div>
  </dialog>, document.body);
}
