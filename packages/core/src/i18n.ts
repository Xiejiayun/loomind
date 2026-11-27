import type { PaletteId, SkeletonId } from "./model/document.js";

export type Locale = "zh" | "en";

export const LOCALE_STORAGE_KEY = "loomind-locale";

interface BrowserGlobals {
  window?: { localStorage?: { getItem(key: string): string | null; setItem(key: string, value: string): void } };
  navigator?: { language?: string };
  document?: { documentElement?: { lang: string } };
}

function browserGlobals(): BrowserGlobals {
  return globalThis as unknown as BrowserGlobals;
}

export function detectInitialLocale(): Locale {
  const g = browserGlobals();
  if (!g.window) return "zh";
  try {
    const saved = g.window.localStorage?.getItem(LOCALE_STORAGE_KEY);
    if (saved === "zh" || saved === "en") return saved;
  } catch {
    /* Storage may be unavailable. */
  }
  const navLang = g.navigator?.language ?? "";
  return navLang.toLowerCase().startsWith("zh") ? "zh" : "en";
}

let currentLocale: Locale = detectInitialLocale();
const listeners = new Set<() => void>();

function syncDocumentLang(locale: Locale) {
  const docEl = browserGlobals().document?.documentElement;
  if (docEl) {
    docEl.lang = locale === "zh" ? "zh-CN" : "en";
  }
}

syncDocumentLang(currentLocale);

export function getLocale(): Locale {
  return currentLocale;
}

export function setLocale(next: Locale): void {
  if (next === currentLocale) return;
  currentLocale = next;
  syncDocumentLang(next);
  const g = browserGlobals();
  if (g.window) {
    try {
      g.window.localStorage?.setItem(LOCALE_STORAGE_KEY, next);
    } catch {
      /* Storage may be unavailable. */
    }
  }
  for (const listener of listeners) {
    listener();
  }
}

export function toggleLocale(): Locale {
  const next: Locale = currentLocale === "zh" ? "en" : "zh";
  setLocale(next);
  return next;
}

export function subscribeLocale(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getIntlLocale(locale: Locale = currentLocale): string {
  return locale === "zh" ? "zh-CN" : "en-US";
}

const PALETTE_LABELS: Record<Locale, Record<PaletteId, string>> = {
  zh: {
    workspace: "工作区",
    "xmind-rainbow": "XMind 彩虹",
    aurora: "极光蓝紫",
    "warm-paper": "暖纸手札",
    "midnight-neon": "午夜霓虹",
    "obsidian-gold": "黑曜鎏金",
    "minimal-ink": "水墨极简",
    "prism-vibrant": "棱镜活力",
    "forest-calm": "静谧森系",
    "sunset-coral": "日落珊瑚",
    blueprint: "蓝图工程",
  },
  en: {
    workspace: "Workspace",
    "xmind-rainbow": "XMind Rainbow",
    aurora: "Aurora",
    "warm-paper": "Warm Paper",
    "midnight-neon": "Midnight Neon",
    "obsidian-gold": "Obsidian Gold",
    "minimal-ink": "Minimal Ink",
    "prism-vibrant": "Prism Vibrant",
    "forest-calm": "Forest Calm",
    "sunset-coral": "Sunset Coral",
    blueprint: "Blueprint",
  },
};

export function getPaletteLabel(id: PaletteId, locale: Locale = currentLocale): string {
  return PALETTE_LABELS[locale][id] ?? PALETTE_LABELS.en[id] ?? id;
}

const SKELETON_INFO: Record<Locale, Record<SkeletonId, { name: string; description: string }>> = {
  zh: {
    "xmind-organic": {
      name: "有机导图",
      description: "柔和胶囊主分支 + 无框下划线子主题 + 渐细丝带",
    },
    "classic-cards": {
      name: "经典卡片",
      description: "清晰描边圆角卡片与贝塞尔曲线",
    },
    "minimal-pill": {
      name: "极简胶囊",
      description: "全圆角无边框胶囊 + 极细下划线",
    },
    "editorial-underline": {
      name: "编辑排版",
      description: "杂志粗框主题 + 极简双层下划线",
    },
    "technical-elbow": {
      name: "工程折线",
      description: "利落工程方框与正交直角连线",
    },
  },
  en: {
    "xmind-organic": {
      name: "Organic Map",
      description: "Soft capsule branches, frameless underline subtopics & tapered ribbons",
    },
    "classic-cards": {
      name: "Classic Cards",
      description: "Crisp bordered rounded cards with Bezier curves",
    },
    "minimal-pill": {
      name: "Minimal Pill",
      description: "Borderless full-rounded pills with ultra-fine underlines",
    },
    "editorial-underline": {
      name: "Editorial",
      description: "Bold framed root topic with minimalist double underlines",
    },
    "technical-elbow": {
      name: "Technical Elbow",
      description: "Sharp engineering boxes with orthogonal right-angle connectors",
    },
  },
};

export function getSkeletonInfo(
  id: SkeletonId,
  locale: Locale = currentLocale,
): { name: string; description: string } {
  return SKELETON_INFO[locale][id] ?? SKELETON_INFO.en[id] ?? { name: id, description: "" };
}

const TEMPLATE_INFO: Record<Locale, Record<string, { name: string; description: string }>> = {
  zh: {
    "blank-organic": {
      name: "空白有机导图",
      description: "经典 XMind 有机丝带风格，适合自由发散思考",
    },
    "quarterly-okr": {
      name: "季度 OKR 拆解",
      description: "逻辑树结构 + 任务进度自动汇总",
    },
    "swot-matrix": {
      name: "SWOT 战略矩阵",
      description: "二维矩阵视图，清晰对比优势、劣势、机会与威胁",
    },
    "annual-roadmap": {
      name: "产品年度路线图",
      description: "水平时间轴展示季度关键里程碑",
    },
    "system-arch-brace": {
      name: "系统架构拆解",
      description: "括号图 + 蓝图深色工程配色",
    },
    "reading-notes": {
      name: "深度读书笔记",
      description: "暖纸手札风格，内置批注、概要与长备注示例",
    },
    "root-cause-fishbone": {
      name: "问题根因分析",
      description: "经典鱼骨因果图，适合复盘与质量排查",
    },
    "team-org": {
      name: "团队组织架构",
      description: "居中组织结构图 + 午夜霓虹暗色主题",
    },
    "product-launch": {
      name: "产品发布计划",
      description: "树型表格清晰管理上线前、中、后的跨部门检查项",
    },
    "meeting-notes": {
      name: "高效会议纪要",
      description: "缩进目录视图，快速记录议题、结论与待办行动项",
    },
    "project-wbs": {
      name: "项目任务分解 (WBS)",
      description: "黑曜鎏金逻辑树，逐层拆解阶段交付物与责任人",
    },
    "decision-tree": {
      name: "方案决策评估",
      description: "括号结构横向对比多个候选方案的收益、成本与风险",
    },
    "sprint-retro": {
      name: "敏捷迭代复盘",
      description: "四象限矩阵复盘做得好的、待改进的与下阶段行动",
    },
    "study-cornell": {
      name: "课程知识体系",
      description: "森系有机导图，串联核心概念、公式推导与习题要点",
    },
  },
  en: {
    "blank-organic": {
      name: "Blank Organic Map",
      description: "Classic organic ribbon style for freeform brainstorming",
    },
    "quarterly-okr": {
      name: "Quarterly OKRs",
      description: "Logic tree with automatic task progress rollup",
    },
    "swot-matrix": {
      name: "SWOT Matrix",
      description: "2D matrix comparing strengths, weaknesses, opportunities & threats",
    },
    "annual-roadmap": {
      name: "Annual Roadmap",
      description: "Horizontal timeline highlighting quarterly milestones",
    },
    "system-arch-brace": {
      name: "System Architecture",
      description: "Brace map with dark blueprint engineering theme",
    },
    "reading-notes": {
      name: "Reading Notes",
      description: "Warm paper journal with callouts, summaries & markdown notes",
    },
    "root-cause-fishbone": {
      name: "Root Cause Analysis",
      description: "Classic Ishikawa fishbone diagram for retrospectives & QA",
    },
    "team-org": {
      name: "Team Org Chart",
      description: "Centered org chart with Midnight Neon dark palette",
    },
    "product-launch": {
      name: "Product Launch Plan",
      description: "Tree table tracking pre-, during-, and post-launch checklists",
    },
    "meeting-notes": {
      name: "Meeting Minutes",
      description: "Indented outline capturing decisions, action items & blockers",
    },
    "project-wbs": {
      name: "Project WBS",
      description: "Obsidian Gold logic tree breaking down phases & deliverables",
    },
    "decision-tree": {
      name: "Decision Evaluation",
      description: "Brace map comparing trade-offs, benefits & risks side by side",
    },
    "sprint-retro": {
      name: "Sprint Retrospective",
      description: "4-quadrant matrix for Keep, Problem, Try & Kudos",
    },
    "study-cornell": {
      name: "Course Study Guide",
      description: "Forest Calm organic map organizing core concepts & review points",
    },
  },
};

export function getTemplateInfo(
  id: string,
  locale: Locale = currentLocale,
  fallback?: { name: string; description: string },
): { name: string; description: string } {
  return TEMPLATE_INFO[locale][id] ?? fallback ?? { name: id, description: "" };
}
