import { useMemo, useState } from "react";
import { AlignLeft, ArrowRight, Braces, FileText, GitBranch, Grid2x2, ListTree, Milestone, Network, Sparkles, Table2 } from "lucide-react";
import { getTemplate, getTemplateInfo, richTextToPlainText, TEMPLATES, type MindmapDocument, type MindmapTopic } from "@mindmap/core";
import type { WorkspaceSummary } from "./api.js";
import { useI18n } from "./i18n.js";
import { AppLink } from "./navigation.js";
import { documentFromOutline, documentFromTopic, outlineNodeCount, parseOutline, type OutlineNode } from "./outline.js";
import { OutlineTree } from "./OutlineTree.js";

const STRUCTURE_ICONS = {
  mindmap: GitBranch, logic: ListTree, timeline: Milestone, fishbone: FileText, matrix: Grid2x2,
  org: Network, treeTable: Table2, indented: AlignLeft, brace: Braces,
};

function templateOutline(topic: MindmapTopic): OutlineNode {
  return { title: richTextToPlainText(topic.title), children: topic.children.map(templateOutline) };
}

export function CreateView({ mode, initialPrompt, activeWorkspaceId, workspaces, onModeChange, onCreate }: {
  mode: "idea" | "outline";
  initialPrompt: string;
  activeWorkspaceId: string | null;
  workspaces: WorkspaceSummary[];
  onModeChange: (mode: "idea" | "outline") => void;
  onCreate: (document: MindmapDocument, workspaceId: string | null, aiPrompt?: string) => Promise<void>;
}) {
  const { locale, t } = useI18n();
  const writable = workspaces.filter((space) => space.role !== "viewer");
  const [prompt, setPrompt] = useState(initialPrompt);
  const [outlineText, setOutlineText] = useState("");
  const [templateId, setTemplateId] = useState("blank-organic");
  const [workspaceId, setWorkspaceId] = useState<string | null>(() => writable.some((space) => space.id === activeWorkspaceId) ? activeWorkspaceId : null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const empty = !(mode === "idea" ? prompt : outlineText).trim();
  const sample = useMemo(() => empty ? getTemplate(templateId).create() : null, [empty, templateId]);
  const parsed = useMemo(() => {
    if (!outlineText.trim()) return { outline: null, error: "" };
    try { return { outline: parseOutline(outlineText), error: "" }; }
    catch (reason) { return { outline: null, error: reason instanceof Error ? reason.message : t.createView.parseError }; }
  }, [outlineText, t.createView.parseError]);
  const preview = sample ? templateOutline(sample.sheets[0].rootTopic) : mode === "outline" ? parsed.outline : null;

  async function create() {
    if (busy) return;
    setError("");
    setBusy(true);
    try {
      if (sample) { await onCreate(sample, workspaceId); return; }
      const document = mode === "outline"
        ? documentFromOutline(parsed.outline ?? parseOutline(outlineText), templateId)
        : documentFromTopic(prompt, templateId);
      await onCreate(document, workspaceId, mode === "idea" ? prompt.trim() : undefined);
    } catch (reason) { setError(reason instanceof Error ? reason.message : t.createView.createError); }
    finally { setBusy(false); }
  }

  return <div className="lm-content lm-create-view">
    <div className="lm-page-heading"><div><span className="lm-eyebrow">{t.createView.eyebrow}</span><h1>{t.createView.title}</h1><p>{t.createView.desc}</p></div>
      <AppLink href="/app" className="lm-secondary-button">{t.createView.backWorkspace}</AppLink></div>
    <div className="lm-create-tabs" role="tablist" aria-label={t.createView.tabsAria}>
      <button type="button" role="tab" aria-selected={mode === "idea"} onClick={() => { setError(""); onModeChange("idea"); }}><Sparkles size={16}/> {t.createView.tabIdea}</button>
      <button type="button" role="tab" aria-selected={mode === "outline"} onClick={() => { setError(""); onModeChange("outline"); }}><ListTree size={16}/> {t.createView.tabOutline}</button>
    </div>
    <AppLink href="/app/create/source" className="lm-secondary-button">{t.source.heading}</AppLink>
    <div className="lm-create-grid">
      <section className="lm-create-input-panel" aria-label={mode === "outline" ? t.createView.outlineInputAria : t.createView.topicInputAria}>
        {mode === "idea" ? <>
          <div className="lm-panel-heading"><span className="lm-eyebrow">01 / START WITH AN IDEA</span><span className="lm-badge">PRO LLM READY</span></div>
          <h2>{t.createView.ideaHeading}</h2><p>{t.createView.ideaDesc}</p>
          <label htmlFor="lm-topic-input">{t.createView.ideaLabel}</label>
          <textarea id="lm-topic-input" className="lm-create-textarea lm-topic-textarea" value={prompt} maxLength={120}
            onChange={(event) => setPrompt(event.target.value)} placeholder={t.createView.ideaPlaceholder}/>
          <div className="lm-field-foot"><span>{t.createView.ideaFoot}</span><span>{prompt.length} / 120</span></div>
        </> : <>
          <div className="lm-panel-heading"><span className="lm-eyebrow">01 / BRING YOUR OUTLINE</span><span className="lm-badge">READY</span></div>
          <h2>{t.createView.outlineHeading}</h2><p>{t.createView.outlineDesc}</p>
          <label htmlFor="lm-outline-input">{t.createView.outlineLabel}</label>
          <textarea id="lm-outline-input" className="lm-create-textarea" value={outlineText} maxLength={16_000}
            onChange={(event) => setOutlineText(event.target.value)} placeholder={t.createView.outlinePlaceholder}/>
          <div className="lm-field-foot"><span>{t.createView.outlineFoot}</span><span>{outlineText.length} / 16,000</span></div>
          {parsed.error && <p className="lm-inline-error" role="alert">{parsed.error}</p>}
        </>}
      </section>
      <aside className="lm-create-preview-panel" aria-label={t.createView.previewAria}>
        <div className="lm-panel-heading"><span className="lm-eyebrow">02 / STRUCTURE</span><span className="lm-badge">PREVIEW</span></div>
        <h2>{sample ? t.createView.previewSample : mode === "outline" ? t.createView.previewOutlineTitle : t.createView.previewIdeaTitle}</h2>
        <div className="lm-structure-preview">
          {preview ? <OutlineTree outline={preview}/>
            : mode === "outline" ? <p className="lm-muted">{t.createView.previewOutlineEmpty}</p>
            : <div className="lm-topic-preview"><span>{t.createView.previewCenterTopic}</span><strong>{prompt.trim() || t.createView.previewWaiting}</strong><small>{t.createView.previewAddLater}</small></div>}
        </div>
        <p className="lm-preview-count">{preview ? t.createView.previewCount(outlineNodeCount(preview), preview.children.length) : t.createView.previewEditableLater}</p>
        <div className="lm-create-settings"><label htmlFor="lm-create-space">{t.createView.saveToLabel}</label><select id="lm-create-space" value={workspaceId ?? ""} onChange={(event) => setWorkspaceId(event.target.value || null)}>
          <option value="">{t.common.myMaps}</option>{writable.map((space) => <option key={space.id} value={space.id}>{space.name}</option>)}
        </select>{workspaceId && <AppLink href={`/app/library?workspace=${encodeURIComponent(workspaceId)}`} className="lm-secondary-button">{t.library.teamLink}</AppLink>}</div>
      </aside>
    </div>
    <section className="lm-template-section" aria-labelledby="lm-template-title"><div className="lm-section-line"><div><span className="lm-eyebrow">03 / VISUAL LANGUAGE</span><h2 id="lm-template-title">{t.createView.templateTitle}</h2></div><p>{t.createView.templateNote}</p></div>
      <div className="lm-template-grid">{TEMPLATES.map((template) => {
        const Icon = STRUCTURE_ICONS[template.structure];
        const info = getTemplateInfo(template.id, locale, template);
        return <button key={template.id} type="button" className="lm-template-card" aria-pressed={templateId === template.id}
          onClick={() => setTemplateId(template.id)}><Icon size={20}/><strong>{info.name}</strong><span>{info.description}</span></button>;
      })}</div></section>
    <div className="lm-create-actions"><span>{sample ? t.createView.footerSample : mode === "outline" ? t.createView.footerOutline : t.createView.footerIdea}</span>
      <button type="button" className="lm-primary-button" disabled={busy || (!sample && (mode === "outline" ? !parsed.outline?.children.length : !prompt.trim()))}
        onClick={() => void create()}>{busy ? t.createView.creating : sample ? t.createView.createSample : t.createView.createBtn}<ArrowRight size={17}/></button></div>
    {error && <p className="lm-form-error" role="alert">{error}</p>}
  </div>;
}
