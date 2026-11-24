export interface MarkerDef {
  id: string;
  group: string;
  label: string;
  bg: string;
  fg: string;
}

export const MARKER_CATALOG: MarkerDef[] = [
  // Priority 1-7
  { id: "priority:1", group: "优先级", label: "1", bg: "#EF4444", fg: "#FFF" },
  { id: "priority:2", group: "优先级", label: "2", bg: "#F97316", fg: "#FFF" },
  { id: "priority:3", group: "优先级", label: "3", bg: "#EAB308", fg: "#FFF" },
  { id: "priority:4", group: "优先级", label: "4", bg: "#22C55E", fg: "#FFF" },
  { id: "priority:5", group: "优先级", label: "5", bg: "#3B82F6", fg: "#FFF" },
  { id: "priority:6", group: "优先级", label: "6", bg: "#8B5CF6", fg: "#FFF" },
  { id: "priority:7", group: "优先级", label: "7", bg: "#64748B", fg: "#FFF" },
  // Progress
  { id: "progress:0", group: "进度", label: "○", bg: "#F1F5F9", fg: "#475569" },
  { id: "progress:start", group: "进度", label: "◔", bg: "#E0F2FE", fg: "#0284C7" },
  { id: "progress:half", group: "进度", label: "◑", bg: "#DBEAFE", fg: "#2563EB" },
  { id: "progress:three", group: "进度", label: "◕", bg: "#E0E7FF", fg: "#4F46E5" },
  { id: "progress:done", group: "进度", label: "●", bg: "#DCFCE7", fg: "#16A34A" },
  { id: "progress:pause", group: "进度", label: "⏸", bg: "#FEF3C7", fg: "#D97706" },
  // Flags
  { id: "flag:red", group: "旗帜", label: "⚑", bg: "#FEE2E2", fg: "#DC2626" },
  { id: "flag:orange", group: "旗帜", label: "⚑", bg: "#FFEDD5", fg: "#EA580C" },
  { id: "flag:yellow", group: "旗帜", label: "⚑", bg: "#FEF9C3", fg: "#CA8A04" },
  { id: "flag:green", group: "旗帜", label: "⚑", bg: "#DCFCE7", fg: "#16A34A" },
  { id: "flag:blue", group: "旗帜", label: "⚑", bg: "#DBEAFE", fg: "#2563EB" },
  { id: "flag:purple", group: "旗帜", label: "⚑", bg: "#F3E8FF", fg: "#9333EA" },
  // Stars
  { id: "star:gold", group: "星标", label: "★", bg: "#FEF3C7", fg: "#D97706" },
  { id: "star:red", group: "星标", label: "★", bg: "#FEE2E2", fg: "#DC2626" },
  { id: "star:blue", group: "星标", label: "★", bg: "#DBEAFE", fg: "#2563EB" },
  { id: "star:green", group: "星标", label: "★", bg: "#DCFCE7", fg: "#16A34A" },
  { id: "star:purple", group: "星标", label: "★", bg: "#F3E8FF", fg: "#9333EA" },
  // Arrows
  { id: "arrow:up", group: "方向", label: "↑", bg: "#DCFCE7", fg: "#15803D" },
  { id: "arrow:down", group: "方向", label: "↓", bg: "#FEE2E2", fg: "#B91C1C" },
  { id: "arrow:right", group: "方向", label: "→", bg: "#DBEAFE", fg: "#1D4ED8" },
  { id: "arrow:left", group: "方向", label: "←", bg: "#F1F5F9", fg: "#475569" },
  { id: "arrow:refresh", group: "方向", label: "↻", bg: "#E0E7FF", fg: "#4338CA" },
  // Symbols
  { id: "sym:check", group: "符号", label: "✓", bg: "#DCFCE7", fg: "#15803D" },
  { id: "sym:cross", group: "符号", label: "✕", bg: "#FEE2E2", fg: "#DC2626" },
  { id: "sym:warn", group: "符号", label: "!", bg: "#FEF3C7", fg: "#D97706" },
  { id: "sym:question", group: "符号", label: "?", bg: "#E0F2FE", fg: "#0369A1" },
  { id: "sym:info", group: "符号", label: "i", bg: "#DBEAFE", fg: "#2563EB" },
  { id: "sym:plus", group: "符号", label: "+", bg: "#ECFDF5", fg: "#059669" },
  // Emotions
  { id: "emo:smile", group: "情绪", label: "☺", bg: "#FEF9C3", fg: "#CA8A04" },
  { id: "emo:heart", group: "情绪", label: "♥", bg: "#FFE4E6", fg: "#E11D48" },
  { id: "emo:bolt", group: "情绪", label: "⚡", bg: "#FEF3C7", fg: "#D97706" },
  { id: "emo:fire", group: "情绪", label: "🔥", bg: "#FFEDD5", fg: "#EA580C" },
  { id: "emo:idea", group: "情绪", label: "💡", bg: "#FEF9C3", fg: "#CA8A04" },
  { id: "emo:lock", group: "情绪", label: "🔒", bg: "#F1F5F9", fg: "#334155" },
];

export const MARKER_BY_ID = new Map(MARKER_CATALOG.map((m) => [m.id, m]));

export const STICKER_CATALOG: Array<{ id: string; emoji: string; label: string }> = [
  { id: "rocket", emoji: "🚀", label: "火箭" },
  { id: "lightbulb", emoji: "💡", label: "灵感" },
  { id: "target", emoji: "🎯", label: "目标" },
  { id: "fire", emoji: "🔥", label: "热门" },
  { id: "trophy", emoji: "🏆", label: "里程碑" },
  { id: "chart", emoji: "📈", label: "增长" },
  { id: "brain", emoji: "🧠", label: "思考" },
  { id: "sparkles", emoji: "✨", label: "亮点" },
  { id: "gear", emoji: "⚙️", label: "工程" },
  { id: "shield", emoji: "🛡️", label: "安全" },
  { id: "book", emoji: "📚", label: "知识" },
  { id: "clock", emoji: "⏱️", label: "效率" },
];

export const STICKER_BY_ID = new Map(STICKER_CATALOG.map((s) => [s.id, s]));
