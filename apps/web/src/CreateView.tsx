import { useMemo, useState } from "react";
import { ArrowRight, FileText, GitBranch, ListTree, Milestone, Sparkles } from "lucide-react";
import type { MindmapDocument } from "@mindmap/core";
import type { WorkspaceSummary } from "./api.js";
import { AppLink } from "./navigation.js";
import { documentFromOutline, documentFromTopic, outlineNodeCount, parseOutline } from "./outline.js";
import { OutlineTree } from "./OutlineTree.js";

const templates = [
  { id: "blank-organic", name: "自由导图", detail: "围绕中心主题发散", icon: GitBranch },
  { id: "quarterly-okr", name: "逻辑树", detail: "逐层拆解问题", icon: ListTree },
  { id: "annual-roadmap", name: "时间轴", detail: "梳理阶段和节点", icon: Milestone },
  { id: "root-cause-fishbone", name: "鱼骨图", detail: "分析原因与结果", icon: FileText },
];

export function CreateView({ mode, initialPrompt, activeWorkspaceId, workspaces, onModeChange, onCreate }: {
  mode: "idea" | "outline";
  initialPrompt: string;
  activeWorkspaceId: string | null;
  workspaces: WorkspaceSummary[];
  onModeChange: (mode: "idea" | "outline") => void;
  onCreate: (document: MindmapDocument, workspaceId: string | null) => Promise<void>;
}) {
  const writable = workspaces.filter((space) => space.role !== "viewer");
  const [prompt, setPrompt] = useState(initialPrompt);
  const [outlineText, setOutlineText] = useState("");
  const [templateId, setTemplateId] = useState("blank-organic");
  const [workspaceId, setWorkspaceId] = useState<string | null>(() => writable.some((space) => space.id === activeWorkspaceId) ? activeWorkspaceId : null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const parsed = useMemo(() => {
    if (!outlineText.trim()) return { outline: null, error: "" };
    try { return { outline: parseOutline(outlineText), error: "" }; }
    catch (reason) { return { outline: null, error: reason instanceof Error ? reason.message : "无法解析大纲。" }; }
  }, [outlineText]);

  async function create() {
    if (busy) return;
    setError("");
    setBusy(true);
    try {
      const document = mode === "outline"
        ? documentFromOutline(parsed.outline ?? parseOutline(outlineText), templateId)
        : documentFromTopic(prompt, templateId);
      await onCreate(document, workspaceId);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "创建失败，请重试。"); }
    finally { setBusy(false); }
  }

  return <div className="lm-content lm-create-view">
    <div className="lm-page-heading"><div><span className="lm-eyebrow">NEW MINDMAP / CREATE</span><h1>新建导图</h1><p>先确定要梳理的内容，再选择适合的结构。你可以随时回到编辑器继续调整。</p></div>
      <AppLink href="/app" className="lm-secondary-button">返回工作区</AppLink></div>
    <div className="lm-create-tabs" role="tablist" aria-label="创建方式">
      <button type="button" role="tab" aria-selected={mode === "idea"} onClick={() => { setError(""); onModeChange("idea"); }}><Sparkles size={16}/> 从想法开始</button>
      <button type="button" role="tab" aria-selected={mode === "outline"} onClick={() => { setError(""); onModeChange("outline"); }}><ListTree size={16}/> 导入已有大纲</button>
    </div>
    <div className="lm-create-grid">
      <section className="lm-create-input-panel" aria-label={mode === "outline" ? "大纲输入" : "主题输入"}>
        {mode === "idea" ? <>
          <div className="lm-panel-heading"><span className="lm-eyebrow">01 / START WITH AN IDEA</span><span className="lm-badge">AI COMING SOON</span></div>
          <h2>先记下你的主题</h2><p>对话式 AI 共建将在后续开放。现在可以先创建一张空白导图，在现有编辑器中继续整理。</p>
          <label htmlFor="lm-topic-input">想梳理什么？</label>
          <textarea id="lm-topic-input" className="lm-create-textarea lm-topic-textarea" value={prompt} maxLength={120}
            onChange={(event) => setPrompt(event.target.value)} placeholder="例如：新产品从用户调研到发布的计划"/>
          <div className="lm-field-foot"><span>主题会成为导图的中心节点</span><span>{prompt.length} / 120</span></div>
        </> : <>
          <div className="lm-panel-heading"><span className="lm-eyebrow">01 / BRING YOUR OUTLINE</span><span className="lm-badge">READY</span></div>
          <h2>粘贴你的大纲</h2><p>支持 Markdown 标题、列表和缩进文本。完整层级会保留在导图中，模板只改变布局和配色。</p>
          <label htmlFor="lm-outline-input">大纲内容</label>
          <textarea id="lm-outline-input" className="lm-create-textarea" value={outlineText} maxLength={16_000}
            onChange={(event) => setOutlineText(event.target.value)} placeholder={"# 产品发布计划\n## 用户研究\n- 用户访谈\n- 需求分析\n## 产品定义\n- 核心功能"}/>
          <div className="lm-field-foot"><span>可直接粘贴已有文档的标题与列表</span><span>{outlineText.length} / 16,000</span></div>
          {parsed.error && <p className="lm-inline-error" role="alert">{parsed.error}</p>}
        </>}
      </section>
      <aside className="lm-create-preview-panel" aria-label="导图预览与设置">
        <div className="lm-panel-heading"><span className="lm-eyebrow">02 / STRUCTURE</span><span className="lm-badge">PREVIEW</span></div>
        <h2>{mode === "outline" ? "确认层级" : "导图起点"}</h2>
        <div className="lm-structure-preview">
          {mode === "outline" && parsed.outline ? <OutlineTree outline={parsed.outline}/>
            : mode === "outline" ? <p className="lm-muted">输入大纲后，这里会显示完整层级。</p>
            : <div className="lm-topic-preview"><span>中心主题</span><strong>{prompt.trim() || "等待输入主题"}</strong><small>之后可以在编辑器中添加分支</small></div>}
        </div>
        <p className="lm-preview-count">{mode === "outline" && parsed.outline ? `${outlineNodeCount(parsed.outline)} 个节点 · ${parsed.outline.children.length} 个一级分支` : "结构将在创建后继续编辑"}</p>
        <div className="lm-create-settings"><label htmlFor="lm-create-space">保存到</label><select id="lm-create-space" value={workspaceId ?? ""} onChange={(event) => setWorkspaceId(event.target.value || null)}>
          <option value="">我的导图</option>{writable.map((space) => <option key={space.id} value={space.id}>{space.name}</option>)}
        </select></div>
      </aside>
    </div>
    <section className="lm-template-section" aria-labelledby="lm-template-title"><div className="lm-section-line"><div><span className="lm-eyebrow">03 / VISUAL LANGUAGE</span><h2 id="lm-template-title">选择布局模板</h2></div><p>内容和层级不会被模板示例替换</p></div>
      <div className="lm-template-grid">{templates.map((template) => {
        const Icon = template.icon;
        return <button key={template.id} type="button" className="lm-template-card" aria-pressed={templateId === template.id}
          onClick={() => setTemplateId(template.id)}><Icon size={20}/><strong>{template.name}</strong><span>{template.detail}</span></button>;
      })}</div></section>
    <div className="lm-create-actions"><span>{mode === "outline" ? "确认层级后创建，进入完整编辑器。" : "AI 共建开放前可先手动创建与编辑。"}</span>
      <button type="button" className="lm-primary-button" disabled={busy || (mode === "outline" ? !parsed.outline?.children.length : !prompt.trim())}
        onClick={() => void create()}>{busy ? "正在创建…" : "创建导图"}<ArrowRight size={17}/></button></div>
    {error && <p className="lm-form-error" role="alert">{error}</p>}
  </div>;
}
