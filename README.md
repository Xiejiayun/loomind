<p align="center">
  <img src="apps/web/public/favicon.svg" width="84" height="84" alt="Loomind Logo" />
</p>

<h1 align="center">Loomind</h1>

<p align="center">
  <strong>Modern Mind Mapping & Presentation Workbench — Weave scattered ideas into clear structure.</strong>
</p>

<p align="center">
  9 Professional Structures · 10 Curated Palettes & Hand-Drawn Sketch Mode · Fullscreen Outliner · Pitch Mode 2.0 · Streaming AI Co-Creation · Loro CRDT Real-Time Collaboration · Lossless <code>.xmind</code> / Vector PDF / PPTX I/O
</p>

<p align="center">
  <img src="https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white" alt="React 19" />
  <img src="https://img.shields.io/badge/TypeScript-5.7-3178C6?logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/CRDT-Loro-7C3AED" alt="Loro CRDT" />
  <img src="https://img.shields.io/badge/Deploy-Cloudflare_Workers-F38020?logo=cloudflare&logoColor=white" alt="Cloudflare Workers" />
</p>

---

## Features

### 9 Professional Structures & Mixed Layouts
Switch layout structures per branch on a single canvas to fit every stage from brainstorming to executive presentation:
- **Mind Map** (Balanced / One-Sided)
- **Logic Chart** · **Org Chart** · **Brace Map**
- **Timeline** · **Fishbone Diagram** · **Matrix**
- **Tree Table** · **Indented List**

### Curated Themes & Hand-Drawn Sketch Style
- **10 built-in color palettes**: XMind Rainbow, Aurora, Warm Paper, Midnight Neon (luminous glow dark theme), Obsidian Gold, Minimal Ink, Prism Vibrant, Forest Calm, Sunset Coral, and Blueprint.
- **Rough.js hand-drawn mode**, 8 distinct topic shapes, boundaries, summaries, relationship arrows, rich-text editing (TipTap), and **KaTeX math equations**.
- Dark-mode adaptive chrome and an interactive **Minimap** viewport navigator.

### Streaming AI Co-Creation
- Topic-level AI expansion, brainstorming, and one-click **long-text hybrid reconstruction** that automatically maps schedules to timelines, root-cause risks to fishbones, comparisons to matrices, and action items to task checklists.
- Streaming **Ghost Topic** previews so you can review and accept AI suggestions without disrupting your existing map.

### Real-Time Collaboration & Brainstorm Workshop
- Powered by **Loro CRDT (Wasm)** for conflict-free collaborative editing across tabs (`BroadcastChannel`) and remote rooms (**Cloudflare Durable Objects WebSocket**).
- Live collaborator presence, remote cursors, and quick reactions.

### Pitch Mode 2.0 & Fullscreen Outliner
- **Pitch Mode**: Automatically compiles your mind map into polished presentation slides and exports directly to **`.pptx`**.
- **Dual-View Sync**: Switch seamlessly between the infinite canvas and fullscreen Outliner, complete with Zen focus mode, deep note cards, task drawer, and bi-directional backlinks.

### Lossless Import & Export
- **`.xmind`**: Round-trip support for topics, notes, summaries, floating topics, and relationships.
- **Markdown / OPML 2.0**: Bi-directional conversion preserving hierarchy, notes, and task states.
- **Pure Vector SVG / Vector PDF / PNG / PPTX**: Native `<text>/<tspan>` SVG serialization with zero `foreignObject` distortion.

---

## Architecture

Loomind is organized as a **pnpm Monorepo**:

```text
loomind/
├── apps/
│   └── web/              # Vite + React 19 + Tailwind CSS v4 web app & Cloudflare Workers config
│       └── worker/       # Cloudflare Durable Object WebSocket hub for real-time sync
└── packages/
    ├── core/             # Document schema, 9 layout engines, 10 palettes, Loro CRDT adapter & I/O codecs
    ├── editor/           # Hybrid canvas, TipTap editor, Outliner, Pitch Mode, collab cursors & chrome UI
    └── ai/               # Streaming AI actions, Zod schemas & incremental patcher
```

---

## Getting Started

### Prerequisites
- Node.js >= 20
- pnpm >= 9

### Local Development

```bash
# Install dependencies
pnpm install

# Start the development server
pnpm dev
```

### Scripts

```bash
# Type-check all workspace packages
pnpm typecheck

# Run unit tests (Vitest)
pnpm test

# Build all packages and the web app
pnpm build
```

### Deploy to Cloudflare Workers

```bash
pnpm --filter @mindmap/web deploy
```

---

## Tech Stack

- **Frontend**: React 19 · TypeScript · Vite 6 · Tailwind CSS v4 · Radix UI · Motion
- **Canvas & Layout**: d3-flextree · rbush · Rough.js · TipTap · KaTeX
- **State & Sync**: Zustand · Immer · Zod · Loro CRDT
- **Export & Codecs**: fflate (`.xmind`) · jsPDF + svg2pdf.js · PptxGenJS
