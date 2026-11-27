import {
  createDocument,
  createRichText,
  createSheet,
  createTopic,
  type MindmapDocument,
  type MindmapStructure,
  type PaletteId,
  type SkeletonId,
} from "../model/document.js";

export interface MindmapTemplate {
  id: string;
  name: string;
  description: string;
  structure: MindmapStructure;
  skeletonId: SkeletonId;
  paletteId: PaletteId;
  create: () => MindmapDocument;
}

export const TEMPLATES: MindmapTemplate[] = [
  {
    id: "blank-organic",
    name: "空白有机导图",
    description: "经典 XMind 有机丝带风格，适合自由发散思考",
    structure: "mindmap",
    skeletonId: "xmind-organic",
    paletteId: "workspace",
    create: () =>
      createDocument(
        [
          createSheet(
            "sheet-1",
            "中心主题",
            createTopic("root", "中心主题", {
              children: [
                createTopic("b1", "核心思路", {
                  children: [createTopic("b1-1", "关键洞察"), createTopic("b1-2", "行动方案")],
                }),
                createTopic("b2", "目标拆解", {
                  children: [createTopic("b2-1", "短期里程碑"), createTopic("b2-2", "长期愿景")],
                }),
                createTopic("b3", "资源与风险", {
                  children: [createTopic("b3-1", "核心资源"), createTopic("b3-2", "潜在风险")],
                }),
                createTopic("b4", "复盘与迭代"),
              ],
            }),
            { structure: "mindmap", direction: "bilateral" },
          ),
        ],
        { skeletonId: "xmind-organic", paletteId: "workspace", rainbowBranches: true, handdrawn: false },
      ),
  },
  {
    id: "quarterly-okr",
    name: "季度 OKR 拆解",
    description: "逻辑树结构 + 任务进度自动汇总",
    structure: "logic",
    skeletonId: "xmind-organic",
    paletteId: "aurora",
    create: () =>
      createDocument(
        [
          createSheet(
            "sheet-okr",
            "Q3 季度 OKR",
            createTopic("okr-root", "Q3 增长目标", {
              subtitle: "Product & Engineering",
              children: [
                createTopic("okr-1", "O1: 提升核心留存", {
                  markers: ["priority:1"],
                  children: [
                    createTopic("okr-1-1", "KR1: 次日留存提升至 55%", { task: { status: "done" } }),
                    createTopic("okr-1-2", "KR2: 新手引导完成率 > 80%", { task: { status: "todo" } }),
                  ],
                }),
                createTopic("okr-2", "O2: 打造旗舰编辑体验", {
                  markers: ["priority:2"],
                  children: [
                    createTopic("okr-2-1", "KR1: 首屏渲染 < 300ms", { task: { status: "done" } }),
                    createTopic("okr-2-2", "KR2: 支持 9 种专业结构", { task: { status: "todo" } }),
                  ],
                }),
              ],
            }),
            { structure: "logic", direction: "leftRight" },
          ),
        ],
        { skeletonId: "xmind-organic", paletteId: "aurora" },
      ),
  },
  {
    id: "swot-matrix",
    name: "SWOT 战略矩阵",
    description: "二维矩阵视图，清晰对比优势、劣势、机会与威胁",
    structure: "matrix",
    skeletonId: "classic-cards",
    paletteId: "prism-vibrant",
    create: () =>
      createDocument(
        [
          createSheet(
            "sheet-swot",
            "SWOT 分析",
            createTopic("swot-root", "产品战略 SWOT", {
              children: [
                createTopic("swot-s", "Strengths 优势", {
                  children: [createTopic("swot-s1", "极速混合渲染引擎"), createTopic("swot-s2", "开箱即用 AI 共创")],
                }),
                createTopic("swot-w", "Weaknesses 劣势", {
                  children: [createTopic("swot-w1", "早期品牌知名度低"), createTopic("swot-w2", "移动端适配待完善")],
                }),
                createTopic("swot-o", "Opportunities 机会", {
                  children: [createTopic("swot-o1", "AI 知识工作流爆发"), createTopic("swot-o2", "团队协同需求增长")],
                }),
                createTopic("swot-t", "Threats 威胁", {
                  children: [createTopic("swot-t1", "传统桌面巨头降价"), createTopic("swot-t2", "竞品生态壁垒")],
                }),
              ],
            }),
            { structure: "matrix", direction: "leftRight" },
          ),
        ],
        { skeletonId: "classic-cards", paletteId: "prism-vibrant" },
      ),
  },
  {
    id: "annual-roadmap",
    name: "产品年度路线图",
    description: "水平时间轴展示季度关键里程碑",
    structure: "timeline",
    skeletonId: "xmind-organic",
    paletteId: "xmind-rainbow",
    create: () =>
      createDocument(
        [
          createSheet(
            "sheet-road",
            "年度路线图",
            createTopic("road-root", "2026 产品路线图", {
              children: [
                createTopic("road-q1", "Q1 基础架构", {
                  children: [createTopic("road-q1-1", "内核模型与布局"), createTopic("road-q1-2", "混合画布发布")],
                }),
                createTopic("road-q2", "Q2 专业能力", {
                  children: [createTopic("road-q2-1", "9 大专业结构"), createTopic("road-q2-2", "全屏大纲视图")],
                }),
                createTopic("road-q3", "Q3 AI 与演说", {
                  children: [createTopic("road-q3-1", "流式 AI 共创"), createTopic("road-q3-2", "演说模式 2.0")],
                }),
                createTopic("road-q4", "Q4 实时协同", {
                  children: [createTopic("road-q4-1", "CRDT 多人同步"), createTopic("road-q4-2", "企业版上线")],
                }),
              ],
            }),
            { structure: "timeline", direction: "leftRight" },
          ),
        ],
        { skeletonId: "xmind-organic", paletteId: "xmind-rainbow" },
      ),
  },
  {
    id: "system-arch-brace",
    name: "系统架构拆解",
    description: "括号图 + 蓝图深色工程配色",
    structure: "brace",
    skeletonId: "technical-elbow",
    paletteId: "blueprint",
    create: () =>
      createDocument(
        [
          createSheet(
            "sheet-arch",
            "系统架构",
            createTopic("arch-root", "Mindmap 架构", {
              children: [
                createTopic("arch-core", "@mindmap/core", {
                  children: [createTopic("arch-c1", "语义树模型"), createTopic("arch-c2", "多结构布局引擎")],
                }),
                createTopic("arch-ed", "@mindmap/editor", {
                  children: [createTopic("arch-e1", "四层混合画布"), createTopic("arch-e2", "大纲与演说视图")],
                }),
                createTopic("arch-ai", "@mindmap/ai", {
                  children: [createTopic("arch-a1", "Zod 流式树生成"), createTopic("arch-a2", "6 种节点级共创")],
                }),
              ],
            }),
            { structure: "brace", direction: "leftRight" },
          ),
        ],
        { skeletonId: "technical-elbow", paletteId: "blueprint" },
      ),
  },
  {
    id: "reading-notes",
    name: "深度读书笔记",
    description: "暖纸手札风格，内置批注、概要与长备注示例",
    structure: "mindmap",
    skeletonId: "xmind-organic",
    paletteId: "warm-paper",
    create: () =>
      createDocument(
        [
          createSheet(
            "sheet-book",
            "读书笔记",
            createTopic("book-root", "《思考，快与慢》", {
              subtitle: "Daniel Kahneman",
              children: [
                createTopic("book-1", "系统一：直觉快思考", {
                  callout: { id: "co-1", title: createRichText("自动化 & 低能耗") },
                  children: [
                    createTopic("book-1-1", "启发式偏见"),
                    createTopic("book-1-2", "锚定效应"),
                  ],
                }),
                createTopic("book-2", "系统二：理性慢思考", {
                  note: { format: "markdown", text: "负责复杂计算与自我控制，但容易惰性依赖系统一。" },
                  children: [
                    createTopic("book-2-1", "注意力有限"),
                    createTopic("book-2-2", "克服认知偏差"),
                  ],
                }),
                createTopic("book-3", "前景理论", {
                  labels: ["核心理论", "经济学"],
                  children: [
                    createTopic("book-3-1", "损失厌恶"),
                    createTopic("book-3-2", "参照点依赖"),
                  ],
                }),
              ],
            }),
            {
              structure: "mindmap",
              direction: "bilateral",
              summaries: [
                {
                  id: "sum-book-1",
                  parentId: "book-1",
                  startIndex: 0,
                  endIndex: 1,
                  brace: "curly",
                  topic: createTopic("sum-topic-1", "日常决策主力"),
                },
              ],
            },
          ),
        ],
        { skeletonId: "xmind-organic", paletteId: "warm-paper" },
      ),
  },
  {
    id: "root-cause-fishbone",
    name: "问题根因分析",
    description: "经典鱼骨因果图，适合复盘与质量排查",
    structure: "fishbone",
    skeletonId: "classic-cards",
    paletteId: "sunset-coral",
    create: () =>
      createDocument(
        [
          createSheet(
            "sheet-fish",
            "根因分析",
            createTopic("fish-root", "转化率下降 15%", {
              children: [
                createTopic("fish-1", "产品体验", {
                  children: [createTopic("fish-1-1", "注册流程过长"), createTopic("fish-1-2", "首屏加载慢")],
                }),
                createTopic("fish-2", "流量渠道", {
                  children: [createTopic("fish-2-1", "低质投放占比上升"), createTopic("fish-2-2", "落地页不匹配")],
                }),
                createTopic("fish-3", "定价策略", {
                  children: [createTopic("fish-3-1", "免费额度偏紧")],
                }),
                createTopic("fish-4", "外部竞品", {
                  children: [createTopic("fish-4-1", "竞品限时促销")],
                }),
              ],
            }),
            { structure: "fishbone", direction: "leftRight" },
          ),
        ],
        { skeletonId: "classic-cards", paletteId: "sunset-coral" },
      ),
  },
  {
    id: "team-org",
    name: "团队组织架构",
    description: "居中组织结构图 + 午夜霓虹暗色主题",
    structure: "org",
    skeletonId: "classic-cards",
    paletteId: "midnight-neon",
    create: () =>
      createDocument(
        [
          createSheet(
            "sheet-org",
            "组织架构",
            createTopic("org-root", "CEO / 创始人", {
              children: [
                createTopic("org-1", "产品设计部", {
                  children: [createTopic("org-1-1", "产品组"), createTopic("org-1-2", "体验设计组")],
                }),
                createTopic("org-2", "研发工程部", {
                  children: [createTopic("org-2-1", "前端架构"), createTopic("org-2-2", "AI 算法")],
                }),
                createTopic("org-3", "增长与商业化", {
                  children: [createTopic("org-3-1", "市场品牌"), createTopic("org-3-2", "大客户成功")],
                }),
              ],
            }),
            { structure: "org", direction: "topDown" },
          ),
        ],
        { skeletonId: "classic-cards", paletteId: "midnight-neon" },
      ),
  },
  {
    id: "product-launch",
    name: "产品发布计划",
    description: "树型表格清晰管理上线前、中、后的跨部门检查项",
    structure: "treeTable",
    skeletonId: "classic-cards",
    paletteId: "forest-calm",
    create: () =>
      createDocument(
        [
          createSheet(
            "sheet-launch",
            "产品发布计划",
            createTopic("launch-root", "v2.0 正式发布", {
              children: [
                createTopic("launch-1", "研发与质量", {
                  children: [
                    createTopic("launch-1-1", "核心链路压测通过", { task: { status: "done" } }),
                    createTopic("launch-1-2", "回滚预案演练完成", { task: { status: "todo" } }),
                  ],
                }),
                createTopic("launch-2", "市场与传播", {
                  children: [
                    createTopic("launch-2-1", "发布博客与演示视频", { task: { status: "todo" } }),
                    createTopic("launch-2-2", "种子用户邮件通知", { task: { status: "todo" } }),
                  ],
                }),
                createTopic("launch-3", "上线后观测", {
                  children: [
                    createTopic("launch-3-1", "错误率与延迟看板"),
                    createTopic("launch-3-2", "首周用户反馈收集"),
                  ],
                }),
              ],
            }),
            { structure: "treeTable", direction: "leftRight" },
          ),
        ],
        { skeletonId: "classic-cards", paletteId: "forest-calm" },
      ),
  },
  {
    id: "meeting-notes",
    name: "高效会议纪要",
    description: "缩进目录视图，快速记录议题、结论与待办行动项",
    structure: "indented",
    skeletonId: "editorial-underline",
    paletteId: "minimal-ink",
    create: () =>
      createDocument(
        [
          createSheet(
            "sheet-meeting",
            "周会纪要",
            createTopic("meet-root", "产品研发周会", {
              subtitle: "每周一 10:00 · 45 min",
              children: [
                createTopic("meet-1", "关键结论", {
                  children: [
                    createTopic("meet-1-1", "优先补齐键盘导航与剪贴板体验"),
                    createTopic("meet-1-2", "云端版本历史保留近 20 版快照"),
                  ],
                }),
                createTopic("meet-2", "行动项 Action Items", {
                  children: [
                    createTopic("meet-2-1", "完成协作压测并输出报告", { task: { status: "todo" }, labels: ["研发"] }),
                    createTopic("meet-2-2", "准备发布说明与演示动图", { task: { status: "todo" }, labels: ["产品"] }),
                  ],
                }),
                createTopic("meet-3", "风险与阻塞", {
                  children: [createTopic("meet-3-1", "确认移动端手势兼容性")],
                }),
              ],
            }),
            { structure: "indented", direction: "leftRight" },
          ),
        ],
        { skeletonId: "editorial-underline", paletteId: "minimal-ink" },
      ),
  },
  {
    id: "project-wbs",
    name: "项目任务分解 (WBS)",
    description: "黑曜鎏金逻辑树，逐层拆解阶段交付物与责任人",
    structure: "logic",
    skeletonId: "classic-cards",
    paletteId: "obsidian-gold",
    create: () =>
      createDocument(
        [
          createSheet(
            "sheet-wbs",
            "项目 WBS",
            createTopic("wbs-root", "新平台迁移项目", {
              children: [
                createTopic("wbs-1", "1. 需求与设计", {
                  children: [
                    createTopic("wbs-1-1", "架构评审定稿", { task: { status: "done" } }),
                    createTopic("wbs-1-2", "数据迁移方案", { task: { status: "done" } }),
                  ],
                }),
                createTopic("wbs-2", "2. 工程实施", {
                  children: [
                    createTopic("wbs-2-1", "核心服务改造", { task: { status: "todo" } }),
                    createTopic("wbs-2-2", "灰度发布与双写校验", { task: { status: "todo" } }),
                  ],
                }),
                createTopic("wbs-3", "3. 验收与收尾", {
                  children: [createTopic("wbs-3-1", "性能基准验收"), createTopic("wbs-3-2", "旧环境清理下线")],
                }),
              ],
            }),
            { structure: "logic", direction: "leftRight" },
          ),
        ],
        { skeletonId: "classic-cards", paletteId: "obsidian-gold" },
      ),
  },
  {
    id: "decision-tree",
    name: "方案决策评估",
    description: "括号结构横向对比多个候选方案的收益、成本与风险",
    structure: "brace",
    skeletonId: "minimal-pill",
    paletteId: "aurora",
    create: () =>
      createDocument(
        [
          createSheet(
            "sheet-decision",
            "技术选型评估",
            createTopic("dec-root", "实时同步方案选型", {
              children: [
                createTopic("dec-1", "方案 A：CRDT + D1 增量同步", {
                  markers: ["star:gold"],
                  children: [
                    createTopic("dec-1-1", "优点：零额外付费组件，天然离线合并"),
                    createTopic("dec-1-2", "注意：适合中小团队轮询协同"),
                  ],
                }),
                createTopic("dec-2", "方案 B：WebSocket + Durable Objects", {
                  children: [
                    createTopic("dec-2-1", "优点：毫秒级双向推送"),
                    createTopic("dec-2-2", "成本：需要付费计划与状态运维"),
                  ],
                }),
              ],
            }),
            { structure: "brace", direction: "leftRight" },
          ),
        ],
        { skeletonId: "minimal-pill", paletteId: "aurora" },
      ),
  },
  {
    id: "sprint-retro",
    name: "敏捷迭代复盘",
    description: "四象限矩阵复盘做得好的、待改进的与下阶段行动",
    structure: "matrix",
    skeletonId: "classic-cards",
    paletteId: "sunset-coral",
    create: () =>
      createDocument(
        [
          createSheet(
            "sheet-retro",
            "Sprint 复盘",
            createTopic("retro-root", "Sprint 14 迭代复盘", {
              children: [
                createTopic("retro-1", "做得好 Keep", {
                  children: [createTopic("retro-1-1", "自动化 CI 覆盖完整"), createTopic("retro-1-2", "需求拆分颗粒度合理")],
                }),
                createTopic("retro-2", "待改进 Problem", {
                  children: [createTopic("retro-2-1", "大图拖拽性能偏慢"), createTopic("retro-2-2", "文档更新滞后")],
                }),
                createTopic("retro-3", "尝试项 Try", {
                  children: [createTopic("retro-3-1", "每个特性单 PR 独立验证合入")],
                }),
                createTopic("retro-4", "感谢 Kudos", {
                  children: [createTopic("retro-4-1", "设计团队快速响应视觉打磨")],
                }),
              ],
            }),
            { structure: "matrix", direction: "leftRight" },
          ),
        ],
        { skeletonId: "classic-cards", paletteId: "sunset-coral" },
      ),
  },
  {
    id: "study-cornell",
    name: "课程知识体系",
    description: "森系有机导图，串联核心概念、公式推导与习题要点",
    structure: "mindmap",
    skeletonId: "xmind-organic",
    paletteId: "forest-calm",
    create: () =>
      createDocument(
        [
          createSheet(
            "sheet-study",
            "课程知识体系",
            createTopic("study-root", "分布式系统核心原理", {
              children: [
                createTopic("study-1", "一致性模型", {
                  children: [createTopic("study-1-1", "线性一致性"), createTopic("study-1-2", "最终一致性与 CRDT")],
                }),
                createTopic("study-2", "共识算法", {
                  children: [createTopic("study-2-1", "Raft 领导者选举"), createTopic("study-2-2", "日志复制与安全性")],
                }),
                createTopic("study-3", "容错与恢复", {
                  children: [createTopic("study-3-1", "快照与日志压缩"), createTopic("study-3-2", "幂等与重试策略")],
                }),
              ],
            }),
            { structure: "mindmap", direction: "bilateral" },
          ),
        ],
        { skeletonId: "xmind-organic", paletteId: "forest-calm" },
      ),
  },
];

export function getTemplate(id: string): MindmapTemplate {
  return TEMPLATES.find((t) => t.id === id) ?? TEMPLATES[0];
}
