<p align="center">
  <img src="apps/web/public/favicon.svg" width="84" height="84" alt="Loomind Logo" />
</p>

<h1 align="center">Loomind（思织）</h1>

<p align="center">
  <strong>现代思维导图与演说工作台 — 把零散灵感编织成清晰结构</strong>
</p>

<p align="center">
  9 大专业结构 · 10 套主题配色与手绘风格 · 全屏大纲 · 演说模式 2.0 · 流式 AI 共创 · Loro CRDT 实时协作 · <code>.xmind</code> / 真矢量 PDF / PPTX 无损互通
</p>

<p align="center">
  <img src="https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white" alt="React 19" />
  <img src="https://img.shields.io/badge/TypeScript-5.7-3178C6?logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/CRDT-Loro-7C3AED" alt="Loro CRDT" />
  <img src="https://img.shields.io/badge/Deploy-Cloudflare_Workers-F38020?logo=cloudflare&logoColor=white" alt="Cloudflare Workers" />
</p>

---

## ✨ 核心特性

### 🧭 9 大专业结构与自由混排
支持在同一张画布中按分支切换布局结构，适配从头脑风暴到方案汇报的全场景：
- **思维导图**（左右均衡 / 单侧）
- **逻辑图** · **组织架构图** · **括号图**
- **时间轴** · **鱼骨图** · **矩阵图**
- **树形表格** · **缩进列表**

### 🎨 高颜值主题系统与手绘草图
- 内置 **10 套精选配色**：XMind 彩虹、极光蓝紫、暖纸手札、午夜霓虹（发光暗黑）、黑曜鎏金、水墨极简、棱镜活力、静谧森系、日落珊瑚、蓝图工程。
- 支持 **Rough.js 手绘草图风**、8 种节点几何形状、自定义边框 / 外框 / 概要 / 关联线、富文本编辑（TipTap）与 **KaTeX 数学公式**。
- 暗色模式自适应界面与小地图（Minimap）视口导航。

### 🤖 流式 AI 共创
- 支持节点级 AI 延展、头脑风暴与长文本一键重构为**混合结构脑图**（自动识别排期 → 时间轴、风险 → 鱼骨图、对比 → 矩阵、待办 → 任务清单）。
- 支持流式生成与幽灵节点（Ghost Topic）预览确认，不破坏既有结构。

### 👥 多人实时协作与脑暴工坊
- 基于 **Loro CRDT (Wasm)** 实现低延迟无冲突协同编辑，支持 `BroadcastChannel` 本地多标签协同与 **Cloudflare Durable Objects WebSocket** 远程房间协作。
- 实时在线协作者状态、远程光标与快捷互动反馈。

### 🎤 演说模式 2.0 & 全屏大纲
- **演说模式（Pitch Mode）**：自动将导图编译为丝滑的演示幻灯片，并支持一键导出为 **`.pptx`**。
- **双视图切换**：画布模式与全屏大纲模式（Outliner）无缝联动，配合专注禅模式、深度卡片笔记、任务抽屉与双向链接。

### 📦 全格式无损导入与导出
- **`.xmind`**：支持双向读写主题、备注、概要、浮动主题与关联线。
- **Markdown / OPML 2.0**：支持结构与待办状态往返转换。
- **真矢量 SVG / 真矢量 PDF / PNG / PPTX**：纯矢量 `<text>/<tspan>` 输出，无 `foreignObject` 失真问题。

---

## 🏗️ 项目架构

本项目采用 **pnpm Monorepo** 组织：

```text
loomind/
├── apps/
│   └── web/              # Vite + React 19 + Tailwind CSS v4 前端应用 & Cloudflare Workers 配置
│       └── worker/       # Cloudflare Durable Object 实时协作信令服务
└── packages/
    ├── core/             # 数据模型、9 大布局引擎、10 套主题配色、Loro CRDT 适配器与 I/O 编解码
    ├── editor/           # 混合画布、TipTap 富文本、大纲、演说模式、协作光标与工具栏 UI
    └── ai/               # 流式 AI 动作编排、Schema 校验与增量 Patcher
```

---

## 🚀 快速开始

### 环境要求
- Node.js >= 20
- pnpm >= 9

### 本地开发

```bash
# 安装依赖
pnpm install

# 启动本地开发服务器
pnpm dev
```

### 常用命令

```bash
# 全量类型检查
pnpm typecheck

# 运行单元测试（Vitest）
pnpm test

# 构建所有包与 Web 应用
pnpm build
```

### 部署到 Cloudflare Workers

```bash
pnpm --filter @mindmap/web deploy
```

---

## 🛠️ 技术栈

- **前端框架**：React 19 · TypeScript · Vite 6 · Tailwind CSS v4 · Radix UI · Motion
- **画布与排版**：d3-flextree · rbush · Rough.js · TipTap · KaTeX
- **状态与协同**：Zustand · Immer · Zod · Loro CRDT
- **导入导出**：fflate (`.xmind`) · jsPDF + svg2pdf.js · PptxGenJS
