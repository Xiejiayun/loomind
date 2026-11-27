<p align="center">
  <img src="apps/web/public/favicon.svg" width="84" height="84" alt="Loomind Logo" />
</p>

<h1 align="center">Loomind</h1>

<p align="center">
  <strong>Modern Mind Mapping & Presentation Workbench — Weave scattered ideas into clear structure.</strong>
</p>

<p align="center">
  9 Professional Structures · 14 Curated Templates · 11 Palettes & Hand-Drawn Sketch Mode · Dual-Tier AI Co-Creation · Loro CRDT Live Sync & Version History · Fullscreen Outliner · Pitch Mode · <code>.xmind</code> / Vector PDF / PPTX I/O
</p>

<p align="center">
  <img src="https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white" alt="React 19" />
  <img src="https://img.shields.io/badge/TypeScript-5.7-3178C6?logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/CRDT-Loro-7C3AED" alt="Loro CRDT" />
  <img src="https://img.shields.io/badge/Deploy-Cloudflare_Workers-F38020?logo=cloudflare&logoColor=white" alt="Cloudflare Workers" />
</p>

---

## Features

### 9 Professional Structures, Mixed Layouts & 14 Templates
Switch layout structures per branch on a single canvas to fit every stage from brainstorming to executive presentation:
- **Mind Map** (Balanced / One-Sided)
- **Logic Chart** · **Org Chart** · **Brace Map**
- **Timeline** · **Fishbone Diagram** · **Matrix**
- **Tree Table** · **Indented List**
- **14 curated starter templates** spanning all 9 structures (OKRs, SWOT Matrix, Annual Roadmap, System Architecture, Reading Notes, Fishbone RCA, Org Chart, Product Launch Tree Table, Meeting Minutes, Project WBS, Decision Evaluation, Sprint Retro, and Course Study Guide).

### Keyboard-First Canvas, Trackpad Gestures & Accessibility
- **Structure-aware arrow-key navigation** (`↑ ↓ ← →`) across all 9 layouts with automatic viewport pan-to-reveal.
- **Full clipboard & outline paste**: Copy (`Ctrl+C`), Cut (`Ctrl+X`), Paste (`Ctrl+V`), Duplicate (`Ctrl+D`), plus direct paste of multi-line indented text or Markdown checklists into nested subtrees.
- **Native trackpad & touch gestures**: Two-finger scroll pans the canvas (`Shift+Wheel` pans horizontally), `Ctrl/Cmd+Wheel` or pinch zooms smoothly around the cursor, touch two-finger pinch-zooms + pans, and `Ctrl+= / - / 0 / 1` handle preset zoom & fit-to-view.
- **Structure-aware drag-and-drop** adapting before/after insertion indicators to horizontal (`org`/`timeline`/`fishbone`) vs vertical structures, with zero-layout-recompute preview during `Alt+Drag` offset and width resizing.
- **Global Find & Replace** (`Ctrl+F` / `Ctrl+H`) across titles, subtitles, notes, and labels with rich-text mark preservation and canvas match highlighting.
- **Semantic ARIA accessibility** (`role="tree"` / `treeitem`, `aria-expanded`, `aria-level`, and polite screen-reader live announcements).

### Curated Themes, Rich Media & Hand-Drawn Sketch Style
- **11 built-in color palettes**: Workspace (light/dark adaptive), XMind Rainbow, Aurora, Warm Paper, Midnight Neon, Obsidian Gold, Minimal Ink, Prism Vibrant, Forest Calm, Sunset Coral, and Blueprint.
- **Rough.js hand-drawn mode**, 8 distinct topic shapes, boundaries, summaries, relationship arrows, rich-text editing (TipTap), **KaTeX math equations**, and aspect-ratio-preserving **WebP image compression** for pasted and uploaded images.
- Dark-mode adaptive chrome and an interactive **Minimap** viewport navigator.

### Dual-Tier AI Co-Creation
- **Free `/try` Playground**: Powered by Cloudflare Workers AI (Gemma 4) with a per-device 3-trial signed cookie quota — try AI mind map generation and node actions without signing in.
- **Logged-in Pro Co-Creation**: Streaming AI Chat panel (`⌘J`), inline node AI command bar (`⇧⌘J`), and 6 structured undoable node actions (Expand, Break into Tasks, Summarize, Cluster Boundary, Elaborate Note, Smart Restyle).

### Loro CRDT Live Sync, Cloud Version History & Workspace Sharing
- **Real-time CRDT Collaboration**: Powered by `LoroSyncAdapter` (Movable Tree CRDT) with instant same-browser `BroadcastChannel` sync, Cloudflare D1 incremental delta sync (`/api/mindmaps/:id/collab`), and live collaborator selection presence badges.
- **Cloud Version History**: Automatically snapshots up to 20 cloud revisions per mindmap (`mindmap_revisions`) with live SVG thumbnail previews, JSON download, and non-destructive one-click restore.
- **Member invitations**: Invite a Google account to a workspace or a single mind map as a viewer or editor. Invitation links expire after 7 days; revoking an invitation prevents new joins, not access already granted to a member.
- **Public read-only links**: Off by default. From **Share → Enable read-only link**, the map owner can share all sheets, notes and referenced images with anyone who has the link, without sign-in. Anonymous readers cannot access history, member details or AI chat. Both anonymous and invited viewers refresh the latest saved revision every five seconds while the page is visible; this is not a live keystroke feed. Revocation blocks further public reads without changing member access. It cannot recall copies already viewed or downloaded.

### Pitch Mode 2.0 & Fullscreen Outliner
- **Pitch Mode**: Automatically compiles your mind map into polished presentation slides with speaker notes and exports directly to **`.pptx`**.
- **Dual-View Sync**: Switch seamlessly between the infinite canvas, docked outline sidebar (`⌘O`), and fullscreen Outliner, complete with Zen focus mode, Markdown note cards, and task filtering.

### Lossless Import & Export
- **`.xmind`**: Round-trip support for topics, notes, tasks, layouts, summaries, floating topics, and relationships.
- **Markdown / OPML 2.0**: Bi-directional conversion preserving hierarchy, multi-root OPML documents, notes, and task states.
- **Pure Vector SVG / Vector PDF / PNG / PPTX**: Native `<text>/<tspan>` SVG serialization with zero `foreignObject` distortion.

---

## Architecture

Loomind is organized as a **pnpm Monorepo**:

```text
loomind/
├── apps/
│   └── web/              # Vite + React 19 + Tailwind CSS v4 web app & Cloudflare Workers config
│       ├── migrations/   # D1 SQL migrations (0001..0007: maps, sharing, AI usage, revisions, CRDT collab)
│       └── worker/       # Google / Turnstile auth, D1 drafts/revisions/collab, sharing & dual-tier AI proxy
└── packages/
    ├── core/             # Document schema, 9 layout engines, 14 templates, 11 palettes, Loro CRDT & I/O codecs
    ├── editor/           # Hybrid canvas, TipTap editor, Find & Replace, Outliner, Pitch Mode & chrome UI
    └── ai/               # Streaming SSE protocol, structured patcher & node-level AI action builders
```

---

## Getting Started

### Prerequisites
- Node.js >= 22.12
- pnpm >= 9

### Local Development

```bash
# Install dependencies
pnpm install

# Initialize the local (not remote) D1 database
pnpm --filter @mindmap/web run db:local

# Start Vite on localhost:5173 and the local Worker on 127.0.0.1:8787
pnpm dev
```

Guest editing on `/try` needs no credentials. For a real local login, copy `apps/web/.dev.vars.example` to the ignored `apps/web/.dev.vars`. Set `AUTH_ORIGIN` to the exact Vite origin, register that origin with Google, and use a separate Turnstile widget permitting `localhost`. To use another Vite port, set `LOOMIND_DEV_PORT` and match `AUTH_ORIGIN`. Do not reuse production secrets locally. The tests use a local D1 runtime and explicit Google/Turnstile fixtures, not live provider logins.

### Scripts

```bash
# Type-check all workspace packages (including worker & web tests)
pnpm typecheck

# Run unit & Worker D1 tests (Vitest)
pnpm test

# Benchmark collaborative leaf renames on 1,001- and 3,001-topic maps (command time only)
pnpm exec vitest bench --run packages/core/test/loro-rename.bench.ts

# Build all packages and the web app
pnpm build

# After building: run touch-layout checks in Chromium and WebKit
pnpm exec playwright install chromium webkit
pnpm test:mobile
```

The mobile checks serve the built app on loopback and use explicit API fixtures. They exercise real browser layout, touch input and local map storage, not live Google login, AI generation or cloud sync.

### Login and storage

- **Google:** use a Web application OAuth client with authorized JavaScript origin `https://loomind.jeremyxie.com` (no path). The Google button returns an ID token to a JavaScript popup callback, so no authorized redirect URI or Google client secret is needed. `/api/auth/google` is a same-origin JSON endpoint, not a redirect target.
- **Turnstile:** use the Managed widget for `loomind.jeremyxie.com`. The Worker checks Siteverify success, hostname and `google_login` action before signing a session. `TURNSTILE_SITE_KEY` is public; `TURNSTILE_SECRET` is server-only. Store `GOOGLE_CLIENT_ID`, `TURNSTILE_SECRET` and an independent, randomly generated production `SESSION_SECRET` (at least 32 random bytes, encoded as hex or base64url) in the Worker's protected configuration. Never put secrets in `VITE_*`, the repository or the browser bundle.
- **Mindmaps & Sync:** each verified Google account can create and switch between independent mindmaps in the workspace library. D1 stores each map by its own ID, up to 20 historical revision snapshots, and incremental CRDT deltas for live collaboration, paired with per-tab isolated IndexedDB draft caching. Maps larger than 1 MiB remain local.
- **Cost:** the app runs entirely on Cloudflare Workers, Workers AI, and D1 Free resources and does not require Durable Objects, R2, KV, or a paid plan.

### Release to Cloudflare Workers

The existing `loomind` Worker, custom domain and D1 database are pinned in `apps/web/wrangler.jsonc`. PRs run GitHub Actions CI (`Verify`), and pushes to `main` automatically verify, record a D1 Time Travel recovery point, apply pending D1 migrations (`0001..0007`), deploy the Worker + static assets, and run live production smoke checks. See [production deployment and recovery](docs/DEPLOYMENT.md) for recovery and rollback steps.

---

## Tech Stack

- **Frontend**: React 19 · TypeScript · Vite 6 · Tailwind CSS v4 · Radix UI · Motion
- **Canvas & Layout**: d3-flextree · rbush · Rough.js · TipTap · KaTeX
- **State & Sync**: Zustand · Immer · Zod · Loro CRDT
- **Export & Codecs**: fflate (`.xmind`) · jsPDF + svg2pdf.js · PptxGenJS
