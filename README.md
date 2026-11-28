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

**Team templates:** On a workspace’s map list, its owner or editors can save a workspace map’s last cloud revision as a team template. Open the workspace from the sidebar to see its templates, or use **Browse team templates** from the creation page after selecting a team. Creating a copy starts a new map and revision history in the same workspace; editing or deleting the source, template, or copy does not change the others. Image blocks are copied too. Workspace viewers can see the catalog but cannot publish, remove, or create copies. Each workspace can hold 50 templates.
Switch layout structures per branch on a single canvas to fit every stage from brainstorming to executive presentation:
- **Mind Map** (Balanced / One-Sided)
- **Logic Chart** · **Org Chart** · **Brace Map**
- **Timeline** · **Fishbone Diagram** · **Matrix**
- **Tree Table** · **Indented List**
- **14 curated starter templates** spanning all 9 structures (OKRs, SWOT Matrix, Annual Roadmap, System Architecture, Reading Notes, Fishbone RCA, Org Chart, Product Launch Tree Table, Meeting Minutes, Project WBS, Decision Evaluation, Sprint Retro, and Course Study Guide).
- The workspace composer and **Create** page both offer the full catalog. Enter your own topic or outline to apply the selected layout and palette without copying sample branches. On **Create**, leave the inputs empty to preview and create a separate map with the original Chinese example content, notes and annotations; this does not call AI or replace an existing map.

### Keyboard-First Canvas, Trackpad Gestures & Accessibility
- **Structure-aware arrow-key navigation** (`↑ ↓ ← →`) across all 9 layouts with automatic viewport pan-to-reveal.
- **Full clipboard & outline paste**: Copy (`Ctrl+C`), Cut (`Ctrl+X`), Paste (`Ctrl+V`), Duplicate (`Ctrl+D`), plus direct paste of multi-line indented text or Markdown checklists into nested subtrees.
- **Create from Outline**: Paste headings, bullets, numbered lists or indented plain text in the workspace. Equal indentation makes siblings regardless of the starting margin; indent further to create children. Preview the hierarchy before creating the map.
- **Native trackpad & touch gestures**: Two-finger scroll pans the canvas (`Shift+Wheel` pans horizontally), `Ctrl/Cmd+Wheel` or pinch zooms smoothly around the cursor, touch two-finger pinch-zooms + pans, and `Ctrl+= / - / 0 / 1` handle preset zoom & fit-to-view.
- **Structure-aware drag-and-drop** adapting before/after insertion indicators to horizontal (`org`/`timeline`/`fishbone`) vs vertical structures, with zero-layout-recompute preview during `Alt+Drag` offset and width resizing.
- **Global Find & Replace** (`Ctrl+F` / `Ctrl+H`) across titles, subtitles, notes, and labels with rich-text mark preservation and canvas match highlighting.
- **Semantic ARIA accessibility** (`role="tree"` / `treeitem`, `aria-expanded`, `aria-level`, and polite screen-reader live announcements).

### Curated Themes, Rich Media & Hand-Drawn Sketch Style
- **11 built-in color palettes**: Workspace (light/dark adaptive), XMind Rainbow, Aurora, Warm Paper, Midnight Neon, Obsidian Gold, Minimal Ink, Prism Vibrant, Forest Calm, Sunset Coral, and Blueprint.
- **Rough.js hand-drawn mode**, 8 distinct topic shapes, boundaries, summaries, relationship arrows, rich-text editing (TipTap), **KaTeX math equations**, and aspect-ratio-preserving **WebP image compression** for pasted and uploaded images.
- Dark-mode adaptive chrome and an interactive **Minimap** viewport navigator.

### Dual-Tier AI Co-Creation
- **Composer attachments**: In the workspace prompt, use **+ → Choose files or images**, drop files, or paste a screenshot. Attach up to four PDFs, UTF-8 text/Markdown files, or PNG/JPEG/WebP images. Preview or remove attachments before creating the map; a title or outline is optional. Files are read on-device. Images become map topics, not OCR or AI prompts.
- **What is saved**: Topic notes keep the original text. For pasted text and text files, notes also keep line ranges and any link you supply. PDF page numbers and a webpage’s title, URL and paragraph numbers are for preview only; they are not added to new maps or PowerPoint exports. Existing maps are unchanged. PDFs need a text layer (up to 16 MiB and 100 pages). To import a supported article, use **+ → Import webpage → Read webpage**; pasting a link alone never fetches it.
- **Web sources**: Signed-in readers can import UTF-8 HTML from the listed publishers (MDN, W3C, and English/Chinese Wikipedia by default), including pages without browser CORS. The server reads static paragraphs without account cookies or JavaScript; check the preview before creating a map. The preview flags partial imports beyond 80 paragraphs or 16,000 characters. For other publishers, sign-in walls, or list-only material, paste the relevant text. Operators can set `SOURCE_WEB_ORIGINS` to a comma-separated list of exact, trusted public HTTPS origins; redirects must also stay on that list. Fetches are limited to 1 MiB, eight seconds, and ten reads per minute per account at each Cloudflare location.
- **Content and language**: The AI follows explicit language and count requests. Otherwise it writes in the language of the question and lets the material determine the branches and depth. Node shortcuts without a written question keep the topic's language; changing the interface language does not change generated content. Canvas size and request limits still apply.
- **No automatic demo content**: Without a configured provider, generation reports unavailable. To exercise a fixed, labeled fixture, explicitly set `AI_ALLOW_MOCK=true` in a local Worker environment or pass `demo: true` to the standalone AI helpers.
- **Free `/try` Playground**: Powered by Cloudflare Workers AI (Gemma 4) with a per-device 3-trial signed cookie quota — try AI mind map generation and node actions without signing in.
- **Editing with AI Chat**: Open the sidebar with `⌘J` / `Ctrl+J`, or right-click a topic to ask about it in chat. With a topic selected, choose **Topic actions** to expand it, break it into tasks, summarize, add a note, cluster, or restyle. You can type an instruction before choosing an action; the change is undoable.

### Loro CRDT Live Sync, Cloud Version History & Workspace Sharing
- **Collaboration**: The editor uses a Loro movable-tree CRDT, `BroadcastChannel`, and an HTTP delta log in D1 (`/api/mindmaps/:id/collab`). It shows other editors’ selections.
- **Cloud Version History**: Automatically snapshots up to 20 cloud revisions per mindmap (`mindmap_revisions`) with live SVG thumbnail previews, JSON download, and non-destructive one-click restore.
- **Photos in live sessions**: New editing histories store one CRDT entry per image so uploading a photo does not retransmit older ones or replace another editor’s independently added image. Existing single-dictionary histories keep their original encoding. Reload older editor tabs before collaborating; the saved document JSON is unchanged.
- **Concurrent editing and reconnect**: Editors share a persisted Loro history rather than creating independent trees from the same JSON. An editor can merge a newer saved checkpoint with unsaved edits after disconnecting or missing deltas. A legacy JSON-only save starts a new history; incompatible unsaved drafts are kept locally for explicit recovery.
- **Collaboration transport limits**: One edit frame can carry 1.5 MiB of base64 (1,152 KiB of binary data). Each pull returns an ordered prefix of up to 100 frames and 1.5 MiB of encoded updates. D1 retains the newest 200 frames or 37.5 MiB of encoded updates per map, whichever fills first. This log is not a backup; a successful upload does not prove that another editor has applied an edit.
- **Member invitations**: Invite a Google account to a workspace or a single mind map as a viewer or editor. Invitation links expire after 7 days; revoking an invitation prevents new joins, not access already granted to a member.
- **Public read-only links**: Off by default. From **Share → Enable read-only link**, the map owner can share all sheets, notes and referenced images with anyone who has the link, without sign-in. Anonymous readers cannot access history, member details or AI chat. Both anonymous and invited viewers refresh the latest saved revision every five seconds while the page is visible; this is not a live keystroke feed. Revocation blocks further public reads without changing member access. It cannot recall copies already viewed or downloaded.
- **Reviewing a photo-heavy map**: Readers get the same saved photos and source notes whether the cloud snapshot fits in one row or several. Comments remain member-only; revoking the public link does not revoke a member's invitation or delete the discussion.
- **Node comments**: Select a saved topic and open **Node comments** to start a discussion. Map members can read it; the owner and editors can reply, resolve or reopen it. Viewers can post and reply only if the map owner enables **Allow viewers to comment**; this does not grant map editing. Members see each author's account email. Refresh the dialog to see others' replies. Discussions follow node IDs through renames and remain labeled after node deletion. File exports and map revision restores do not include or modify these separate records; deleting the map removes them.
- **Workspace sidebar**: Open a workspace by its name or expand its arrow to see maps. **Personal** holds your unfiled maps; **Shared**, directly below it by default, holds incoming maps and the workspaces you’ve joined. Use **Reorder workspaces** beside the Workspaces heading to save your own sidebar order across devices. Global search still finds maps across workspaces.

### Pitch Mode 2.0 & Fullscreen Outliner
- **Pitch Mode**: Automatically compiles your mind map into polished presentation slides with speaker notes and exports directly to **`.pptx`**.
- **Dual-View Sync**: Switch seamlessly between the infinite canvas, docked outline sidebar (`⌘O`), and fullscreen Outliner, complete with Zen focus mode, Markdown note cards, and task filtering.

### Lossless Import & Export
- **Loomind full backup (`.loomind.json`)**: In **Export**, save a complete editable copy with every sheet, image, equation and text style. To restore it (or an existing map/revision JSON download), open a blank map, select **Export → Import backup or file**, then confirm replacement. No cloud connection is required once the editor is loaded.
- **`.xmind`**: Imports modern `content.json` workbooks as editable maps. Each sheet keeps its own canvas color, branch palette, and supported topic fonts, sizes, fills, outlines and connectors. Clockwise maps preserve reading order; an explicit right-side count takes precedence over automatic balancing. Unavailable fonts use local fallbacks, and hand-drawn lines and hatching are approximations, not pixel-exact copies. The codec also exchanges notes, tasks, summaries, floating topics, relationships, embedded images, rich titles and equation source. Use a Loomind backup for full fidelity; editing and resaving in Xmind desktop is not guaranteed lossless.
- **Markdown / OPML 2.0**: Bi-directional conversion preserving hierarchy, multi-root OPML documents, notes, and task states.
- **Pure Vector SVG / Vector PDF / PNG / PPTX**: Native `<text>/<tspan>` SVG serialization with zero `foreignObject` distortion.

---

## Architecture

Loomind is organized as a **pnpm Monorepo**:

```text
loomind/
├── apps/
│   └── web/              # Vite + React 19 + Tailwind CSS v4 web app & Cloudflare Workers config
│       ├── migrations/   # D1 migrations for maps, sharing, AI, revisions, document blocks, collaboration, reviews, templates & sidebar preferences
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

# Benchmark idle collaboration polling against local D1 (1 or 8 concurrent readers)
pnpm exec vitest bench --run apps/web/test/collab-poll.bench.ts

# Build all packages and the web app
pnpm build

# After building: run touch-layout checks in Chromium and WebKit
pnpm exec playwright install chromium webkit
pnpm test:mobile
```

Mobile layout tests use loopback and explicit API fixtures. The live editing tests run the built app against a real local Worker and D1, with isolated signed test accounts in Chromium and WebKit. They check unsaved changes in both canvases, late joining, retry, offline recovery, images and cold reopen; they do not call production, Google login or AI models. Set `LOOMIND_E2E_LARGE_FRAME=1` to require a successful frame larger than 192 KiB reaching the peer canvas without a full document reload. The transport test separately verifies byte-for-byte delivery.
The cloud-storage tests upload photos in the editor, reopen them in the other browser engine, download the earlier version, and check that over-limit edits stay on the originating device.

See the [collaboration polling benchmark report](docs/COLLAB_POLL_PERFORMANCE.md) for before/after timings and measurement limits.

### Login and storage

- **Google:** use a Web application OAuth client with authorized JavaScript origin `https://loomind.jeremyxie.com` (no path). The Google button returns an ID token to a JavaScript popup callback, so no authorized redirect URI or Google client secret is needed. `/api/auth/google` is a same-origin JSON endpoint, not a redirect target.
- **Turnstile:** use the Managed widget for `loomind.jeremyxie.com`. The Worker checks Siteverify success, hostname and `google_login` action before signing a session. `TURNSTILE_SITE_KEY` is public; `TURNSTILE_SECRET` is server-only. Store `GOOGLE_CLIENT_ID`, `TURNSTILE_SECRET` and an independent, randomly generated production `SESSION_SECRET` (at least 32 random bytes, encoded as hex or base64url) in the Worker's protected configuration. Never put secrets in `VITE_*`, the repository or the browser bundle.
- **Mindmaps & Sync:** cloud saves accept up to 4 MiB of UTF-8 document JSON, including embedded images. Oversized edits stay in this browser without replacing the last cloud version; reduce the map size to resume syncing. D1 keeps the latest 20 snapshots. Documents over 1 MiB share content-addressed blocks across revisions of the same map. Current state, blocks, and history commit together. Live CRDT updates have a separate limit.
- **Cost:** the app runs entirely on Cloudflare Workers, Workers AI, and D1 Free resources and does not require Durable Objects, R2, KV, or a paid plan.

### Release to Cloudflare Workers

The existing `loomind` Worker, custom domain and D1 database are pinned in `apps/web/wrangler.jsonc`. PRs run GitHub Actions CI (`Verify`), and pushes to `main` automatically verify, record a D1 Time Travel recovery point, apply pending D1 migrations, deploy the Worker + static assets, and run live production smoke checks. Live checkpoint sync requires `0013_live_checkpoints.sql` before the new Worker handles requests. See [production deployment and recovery](docs/DEPLOYMENT.md) for recovery and rollback steps.

---

## Tech Stack

- **Frontend**: React 19 · TypeScript · Vite 6 · Tailwind CSS v4 · Radix UI · Motion
- **Canvas & Layout**: d3-flextree · rbush · Rough.js · TipTap · KaTeX
- **State & Sync**: Zustand · Immer · Zod · Loro CRDT
- **Export & Codecs**: fflate (`.xmind`) · jsPDF + svg2pdf.js · PptxGenJS
