<p align="center">
  <img src="apps/web/public/favicon.svg" width="84" height="84" alt="Loomind Logo" />
</p>

<h1 align="center">Loomind</h1>

<p align="center">
  <strong>Modern Mind Mapping & Presentation Workbench — Weave scattered ideas into clear structure.</strong>
</p>

<p align="center">
  9 Professional Structures · 10 Curated Palettes & Hand-Drawn Sketch Mode · Fullscreen Outliner · Pitch Mode · Multiple Mindmaps & Shared Workspaces · <code>.xmind</code> / Vector PDF / PPTX I/O
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

### Mindmap Library & Outline Import
- Each Google account can create and switch between multiple independent mindmaps, search the library, and continue a saved map in the existing editor.
- Import Markdown headings, lists, or indented text as a full hierarchy. Choose a visual template without replacing the imported content.
- An idea can start a blank mindmap. Conversational AI co-creation is planned for Aerial Web; this release does not connect a model or generate AI content.

### Workspace & Mindmap Sharing
- Invite another Google account to an entire workspace or a single mindmap with editor or viewer access. Invitations expire after seven days and can be revoked before acceptance.
- The Worker checks each read and write against the signed session. D1 revisions prevent one editor from silently overwriting another's changes; editing is not live multi-user sync.

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
│       └── worker/       # Google / Turnstile authentication and private D1 draft API
└── packages/
    ├── core/             # Document schema, 9 layout engines, 10 palettes & I/O codecs
    ├── editor/           # Hybrid canvas, TipTap editor, Outliner, Pitch Mode & chrome UI
    └── ai/               # Existing experimental helpers; no production model connection
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

Guest editing needs no credentials. For a real local login, copy `apps/web/.dev.vars.example` to the ignored `apps/web/.dev.vars`. Set `AUTH_ORIGIN` to the exact Vite origin, register that origin with Google, and use a separate Turnstile widget permitting `localhost`. To use another Vite port, set `LOOMIND_DEV_PORT` and match `AUTH_ORIGIN`. Do not reuse production secrets locally. The tests use a local D1 runtime and explicit Google/Turnstile fixtures, not live provider logins.

### Scripts

```bash
# Type-check all workspace packages
pnpm typecheck

# Run unit tests (Vitest)
pnpm test

# Build all packages and the web app
pnpm build
```

### Login and storage

- **Google:** use a Web application OAuth client with authorized JavaScript origin `https://loomind.jeremyxie.com` (no path). The Google button returns an ID token to a JavaScript popup callback, so no authorized redirect URI or Google client secret is needed. `/api/auth/google` is a same-origin JSON endpoint, not a redirect target.
- **Turnstile:** use the Managed widget for `loomind.jeremyxie.com`. The Worker checks Siteverify success, hostname and `google_login` action before signing a session. `TURNSTILE_SITE_KEY` is public; `TURNSTILE_SECRET` is server-only. Store `GOOGLE_CLIENT_ID`, `TURNSTILE_SECRET` and an independent, randomly generated production `SESSION_SECRET` (at least 32 random bytes, encoded as hex or base64url) in the Worker's protected configuration. Never put secrets in `VITE_*`, the repository or the browser bundle.
- **Mindmaps:** guests keep a separate IndexedDB document; it is never uploaded on login. Each verified Google account can create and switch between independent mindmaps in the workspace library. D1 stores each map by its own ID and Google `sub`, with a separate IndexedDB cache and revision. The editor account button shows sync status for the current map. Edits sync after 2.5 seconds idle. Revision conflicts stop uploads; export the local copy before choosing the cloud version. Maps larger than 1 MiB remain local. To move a guest map into an account, export it as `.xmind`, sign in, then import it intentionally.
- **Cost:** the app uses the existing Workers and D1 Free resources and does not require R2, KV or a paid plan. If storage or quota is exhausted, cloud sync shows an error instead of discarding the local draft.

### Release to Cloudflare Workers

The existing `loomind` Worker, custom domain and D1 database are pinned in `apps/web/wrangler.jsonc`. The fourth migration adds shared workspaces, member roles and invitations to the existing `mindmaps` table. Worker rollback does not restore D1 data.

PRs and pushes to `main` run GitHub Actions CI. Production deployment is a separate, manually dispatched workflow for an E2E-tested `main` commit; it waits for `production` environment approval, records the previous Worker version and a D1 Time Travel bookmark, applies pending migrations, deploys, and checks public health. See [production deployment and recovery](docs/DEPLOYMENT.md) for required repository settings, acceptance and rollback steps.

---

## Tech Stack

- **Frontend**: React 19 · TypeScript · Vite 6 · Tailwind CSS v4 · Radix UI · Motion
- **Canvas & Layout**: d3-flextree · rbush · Rough.js · TipTap · KaTeX
- **State & Sync**: Zustand · Immer · Zod · Loro CRDT
- **Export & Codecs**: fflate (`.xmind`) · jsPDF + svg2pdf.js · PptxGenJS
