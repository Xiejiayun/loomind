# Loomind 优化方案与逐任务实施计划（2026-11-26）

> **状态**：已通过架构与实现双方 5 轮双向实质讨论收束，作为后续逐任务独立 PR 实施与审查的执行基线。
> **适用范围**：仅限代码、测试与工程文档优化；**不包含**生产部署、数据库生产迁移、Cloudflare/GitHub 凭据或分支保护变更。

---

## 1. 冻结基线与仓库保护现状

- **目标仓库**：`github:xiejiayun/loomind`
- **冻结讨论基线（`origin/main`）**：`7fc979c051b7c7ec33be1c22da6d5184ab450d03`（2026-11-26，`feat(copy): Loom for Mind positioning, Designing Calm Software interactive showcase & CN/EN editorial copy (#32)`）
- **基线核对时开放 PR**：`0`
- **主分支保护现状（GitHub API 只读核实）**：
  - `protected = true`
  - 经典分支保护要求必过检查 `Verify`（`strict = true`，`enforce_admins = true`）
  - `allow_force_pushes = false`，`allow_deletions = false`
  - `required_pull_request_reviews = null`；仓库分支规则集（rulesets）返回 `[]`
  - *治理约束*：仓库当前未强制 GitHub PR Review 审批，但这**不免除**本方案约定的独立审查与架构师对确切最新 `head SHA` 的明确“可合并”确认，也不允许使用 `--admin` 或任何方式绕过分支保护。
- **CI 基线（`origin/main@7fc979c`，Run `45805166129`）**：
  - `.github/workflows/ci.yml`（Job `Verify`）：`pnpm install --frozen-lockfile` → `pnpm typecheck` → `pnpm test` → `pnpm build`，全部通过（7 个测试文件 / 55 个用例通过，`vitest.config.ts` 仅配置 `environment: "node"`，`packages/editor` 当前 0 测试文件）。
- **实施前基线重核规则**：进入实施阶段后，随着前序 PR 合入，`origin/main` 会前进；每个任务切分支时必须以当时最新 `origin/main` 为起点并重核相关路径，在 PR 中显式给出 `base SHA` 与最终审查的完整 `head SHA`。

---

## 2. 仓库架构与核心数据流概况

```text
loomind/
├── .github/workflows/
│   ├── ci.yml                     # PR 与 main 推送校验（Verify: typecheck / test / build）
│   └── deploy-production.yml      # 手动触发的受控 Cloudflare 生产发布工作流
├── docs/
│   ├── DEPLOYMENT.md              # 生产发布与回滚操作手册
│   └── OPTIMIZATION_PLAN_2026-11-26.md  # 本文档
├── apps/web/                      # @mindmap/web（React 19 + Vite 6 + Tailwind v4 + Cloudflare Worker）
│   ├── src/                       # 认证、工作区、IndexedDB 本地持久化、云端同步状态机
│   ├── worker/                    # Cloudflare Worker API（/api/auth/*, /api/mindmaps/*, /api/workspaces/*, /api/shares/*, /api/invites/*）
│   ├── migrations/                # D1 SQL 迁移 0001..0004
│   └── test/                      # Vitest Node 测试（worker.test.ts 走本地 workerd D1 代理，workspace.test.ts 走 fake-indexeddb）
└── packages/
    ├── core/                      # @mindmap/core（Zod schema、不变量校验、Immer reducer、Zustand store、Loro adapter、9 种布局、XMind/MD/OPML/SVG 编解码）
    ├── editor/                    # @mindmap/editor（HybridCanvas、TopicCard、TipTap TopicEditor、OutlinerView、PitchOverlay、FormatPanel、ExportModal 等）
    └── ai/                        # @mindmap/ai（Vercel AI SDK 封装与本地演示生成逻辑）
```

### 核心数据流

1. **认证与会话**：两步登录（`apps/web/src/auth/LoginForm.tsx`）通过 `POST /api/auth/challenge` → Turnstile → Google ID Token → `POST /api/auth/google` 签发 `__Host-loomind-session` Cookie（`apps/web/worker/auth.ts`）；多标签会话刷新通过 `BroadcastChannel("loomind-auth")` 与 `focus` 触发（`apps/web/src/auth/session.ts`）。
2. **编辑 → 本地 IndexedDB → 云端 D1 同步**：
   - 编辑器通过 `LocalImmerSyncAdapter`（`packages/core/src/store/sync-adapter.ts`）维护文档与撤销历史；每次文档变更经 `apps/web/src/EditorWorkspace.tsx:94-97` 通知 `DraftWorkspace.edit(doc)`（`apps/web/src/drafts/workspace.ts:67-74`）。
   - `DraftWorkspace` 以 `250ms` 防抖写入 IndexedDB（`loomind-db` / `docs` store，现行共享键 `google:${owner}:${id}`，`apps/web/src/persistence.ts:7-9, 43-51`），以 `2500ms` 防抖带 `If-Match: "<revision>"` 发起 `PUT /api/mindmaps/:id`。
   - Worker（`apps/web/worker/drafts.ts:62-73, 90-108`）对每次 `PUT` 强制执行 `MindmapDocumentSchema.safeParse`、`validateDocumentInvariants`、`DRAFT_LIMIT`（1 MiB）与 `revision` 乐观并发检查后写入 D1；单图 `GET` 对不存在或无权限统一返回 `{ revision: 0, document: null }`（`apps/web/worker/drafts.ts:40-44`）。
3. **共享与只读协作**：通过 `apps/web/worker/sharing.ts` 管理 7 天分享链接与成员权限；`ViewerEditor`（`apps/web/src/EditorWorkspace.tsx:132-184`）以只读方式挂载编辑器。

---

## 3. 前期已执行验证与诚实边界声明

本方案编制阶段严格保持只读核对，未修改仓库源码或锁文件，亦未执行部署或修改外部环境。前期核对证据的**实际边界**如下（不得将下列内存验证冒充为真实浏览器、真实 D1 或全量锁文件验证）：

| 验证批次 | 执行内容与结果 | 真实环境与边界限制 |
|---|---|---|
| **GitHub CI 基线读取** | 读取 `origin/main@7fc979c` 最新 CI Run `45805166129`（`Verify` 通过，7 文件 55 用例）。 | 覆盖既有 Node 单测与构建；不包含 `apps/web/test/*` 类型检查，不包含 `packages/editor` 组件/浏览器测试。 |
| **源码全仓静态核对** | 在独立只读工作区逐文件核对 `0c483e9..7fc979c` 变更与全部历史线索及当前代码路径。 | 纯静态读码；初轮只读静态核对在无 `node_modules` 的干净隔离工作区执行，该阶段未运行本地安装或测试。 |
| **初轮定向内存验证（7 项）** | 针对 `7fc979c` 冻结源码运行 7 项定向 Vitest 内存测试（7/7 通过）：双标签 CAS 后本地缓存覆盖（409 前/后）、概要 `indent`/`outdent`/`reparent` 产生 `INVALID_SUMMARY_RANGE`、`addSibling` 合法平移、远端空文档导致 clean 缓存误报 `synced`、XMind 往返丢布局/任务与嵌套概要改挂根、OPML 双顶层仅留后者。 | 随后在独立本地临时目录复用既有本地依赖执行，使用内存 mock 存储/云端；**未执行**干净 `--frozen-lockfile` 重装、真实浏览器、真实 Worker/D1 网络调用或原生 XMind 客户端验证；422 为服务端源码静态链路推断。 |
| **输入与结构引用补核（1+5 项）** | 针对 `7fc979c` 运行 6 项定向 Vitest 测试（6/6 通过）：`replaceSheetRoot` 与概要级联悬空引用、`relationship/upsert` 6 位色、真实 TipTap 2.27.3 schema 构造 `#FEF08A` 高亮 mark 致 `loadLocal` parse 失败（且确认原 IDB 记录保留而非永久删除）、图片 `image/gif` MIME 拒判与移除图片后残留资产触发客户端 1 MiB 413、双 adapter（`LocalImmer` / `Loro`）拒绝边界。 | 随后在独立本地临时目录复用既有本地依赖执行，使用合成测试数据与 `fake-indexeddb`/mock 云端；**真实浏览器点击/键盘/剪贴板验证未完成**（因浏览器自动化工具无法校验当前 URL 许可而停止，该子任务结果为 `failed`）。 |

> **重要区分**：第 6 节中各任务列出的“实施期必过验收命令”是**未来逐任务 PR 必须实际运行并贴出真实结果的验收要求**，不是当前已完成执行的验证。

---

## 4. 四分类证据矩阵（基于 `origin/main@7fc979c`）

### 4.1 已证实缺陷（Confirmed — 纳入本批 8 项独立任务）

| 编号 | 问题描述 | 精确源码位置（`7fc979c`） | 验证状态与真实影响 | 归属任务 |
|---|---|---|---|---|
| **E1** | 同账号同图多标签共享无保护 IndexedDB 键，胜者回写覆盖他页未确认草稿（无论在 409 前或 409 后发生），刷新后分歧稿丢失 | `apps/web/src/persistence.ts:7-9, 43-51`；`apps/web/src/drafts/workspace.ts:67-74, 81-91, 108-125, 130-135` | 源码 + 7 项定向内存验证已证实 | **T1** |
| **E2** | 远端删除或失权后单图 `GET` 返回 `{revision:0,document:null}`：clean 旧缓存仍显示“已同步”，dirty 缓存陷入“用云端版本→再次 409”循环；列表缺项无状态区分 | `apps/web/worker/drafts.ts:40-44, 90-108`；`apps/web/src/drafts/workspace.ts:99-115, 125-133`；`apps/web/src/WorkspaceApp.tsx:90-116`；`apps/web/src/auth/AccountControl.tsx:34-57` | 定向内存验证已复现 **clean 缓存在 `{revision:0,document:null}` 下误报 `synced`**；**dirty 缓存点击“使用云端版本”进入 409 循环及列表缺项展示**为源码静态链路推断（服务端刻意不区分删除与无权，客户端不得臆断） | **T1** |
| **E3** | 本地坏记录触发 `loadLocal` `MindmapDocumentSchema.parse` 失败后设置 `cacheReadable=false`，普通 UI 无法加载或导出原始坏记录（原记录保留在 IDB 但缺恢复入口，且易被他页覆盖） | `apps/web/src/persistence.ts:28-40, 53-67`；`apps/web/src/drafts/workspace.ts:48-58, 81-85`；`apps/web/src/EditorWorkspace.tsx:76-106` | 源码 + 补核定向 `fake-indexeddb` 验证已证实（注：非“刷新即永久删除”，而是无内置恢复入口） | **T1** |
| **E4** | 结构移动命令 `reparent`/`indent`/`outdent`/`reorder`/`detachToFloating` 未维护 `sheet.summaries`，产生 `INVALID_SUMMARY_RANGE` 或覆盖错位，阻断云端校验保存 | `packages/core/src/model/document.ts:124-130`；`packages/core/src/model/invariants.ts:90-101`；`packages/core/src/store/reducer.ts:249-325`；`packages/editor/src/outline/OutlinerView.tsx:145-149`；`packages/editor/src/canvas/HybridCanvas.tsx:303-327`；`apps/web/worker/drafts.ts:62-71` | 定向核心测试已复现 **`reparent`/`indent`/`outdent` 产生 `INVALID_SUMMARY_RANGE`**；**`reorder`/`detachToFloating` 覆盖语义错位与 Worker HTTP 422 响应**为源码静态链路推断（`addSibling`/`delete` 已有部分维护） | **T2** |
| **E5** | `doc/replaceSheetRoot` 未按消失节点执行级联清理；`cascadeCleanup` 删除失效概要时未递归纳入 `summary.topic` 子树且部分分支未登记概要 ID；`invariants.ts` 未校验 `boundary` 目标存在性 | `packages/core/src/store/reducer.ts:85-116, 171-175, 215-246`；`packages/core/src/model/invariants.ts:90-120`；`packages/ai/src/actions.ts:143-150` | 源码 + 补核定向测试已证实 | **T2** |
| **E6** | TipTap 高亮按钮传入 6 位色 `#FEF08A` 且 `normalizeTipTapJson` 原样透传 marks 并丢弃 `hardBreak`；`TopicCard` 读 `backgroundColor` 而 TipTap 写 `color`；`relationship/upsert` 跳过 `normalizeHexColor` | `packages/editor/src/canvas/TopicEditor.tsx:22-46, 61-74, 157-164`；`packages/editor/src/canvas/TopicCard.tsx:48-69`；`packages/core/src/model/schema.ts:5-8, 55-64, 169-182`；`packages/core/src/store/reducer.ts:546-564` | 源码 + 补核真实 TipTap 2.27.3 schema 测试已证实（真实浏览器点击/粘贴未测；关系 6 位色普通 UI 可达性未证实） | **T3** |
| **E7** | 剪贴板粘贴/文件处理未在写入前校验 `InlineAssetSchema` 允许的 4 种 MIME；清除/替换图片或删节点不回收无引用 `doc.assets`，导致残留资产触发客户端/服务端 1 MiB 413 | `packages/editor/src/canvas/HybridCanvas.tsx:454-484`；`packages/editor/src/chrome/CanvasDock.tsx:129-155, 176-181`；`packages/core/src/model/schema.ts:206-213`；`packages/core/src/store/reducer.ts:491-500`；`apps/web/src/drafts/cloud.ts:40-45` | 源码 + 补核定向测试已证实（属可恢复残留资产 413，非永久 413；真实浏览器剪贴板 MIME 未测） | **T4** |
| **E8** | XMind 导出/导入丢失 sheet 布局/方向/间距及 `topic.task`，将子分支概要扁平写至 `rootTopic` 并在导入时强挂根导致非法范围，且导入缺少 schema/invariants 门禁 | `packages/core/src/io/xmind.ts:38-179`；`packages/core/src/model/document.ts:251-288`；`packages/core/test/io.test.ts:15-25` | 源码 + 真实 codec 内存往返测试已证实（未测原生 XMind 客户端） | **T5** |
| **E9** | OPML 导入遇到多个顶层 `<outline>` 时反复覆写 `root = topic`，仅保留最后一个顶层节点及其子树 | `packages/core/src/io/opml.ts:54-93`；`packages/core/test/io.test.ts:39-46` | 源码 + 真实 codec 内存测试已证实 | **T6** |
| **E10** | `apps/web/package.json` 暴露直接执行 `wrangler deploy` 的 `deploy` 脚本（目标指向生产配置），与受控生产发布工作流不一致；`docs/DEPLOYMENT.md:25` 人工验收清单仍包含过时的“至少检查游客打开编辑器”条目（`docs/DEPLOYMENT.md` 不含 `/try` 字样，第 29 行“游客会话”系对应仍有效的 `/api/auth/session` 自动健康检查，须保留） | `apps/web/package.json:12`；`apps/web/wrangler.jsonc:3-4, 9, 15-20`；`.github/workflows/deploy-production.yml:260-265`；`docs/DEPLOYMENT.md:7, 25, 29` | 源码与文档静态核对已证实（未检查生产凭据/权限，删脚本不等于撤销 Cloudflare 权限） | **T7** |
| **E11** | `apps/web/tsconfig.json` 与 `apps/web/worker/tsconfig.json` 均未包含 `apps/web/test/*`，导致 Web 测试脱离 `pnpm typecheck` 与 CI 类型门禁 | `apps/web/tsconfig.json:8`；`apps/web/worker/tsconfig.json:8`；`apps/web/package.json:13`（对比 `packages/core/tsconfig.json:7` 与 `packages/ai/tsconfig.json:7`） | 配置缺失已证实；具体 TS 编译诊断须在 T8 实施期以实际 `tsc` 输出为准（不预先假定特定四参 mock 必报错） | **T8** |

### 4.2 部分修复 / 残余边界（Partially Fixed）

| 线索 | 现状核对（`7fc979c`） | 处置方式 |
|---|---|---|
| 旧版 `WorkspaceApp` `Ctrl+K` / `n` 与编辑器快捷键冲突 | 原跨视图冲突已由 `apps/web/src/WorkspaceApp.tsx:131, 137` 的 `&& !mapId` 守卫修复；`/login` 路由与工作区互斥（`apps/web/src/App.tsx:55-67`）。另有残余源码线索（`MindmapEditor.tsx:140-143` `Ctrl/Cmd+I` 与 `HybridCanvas.tsx:492-592` 在 `PitchOverlay`/弹窗下键盘处理），尚无浏览器/DOM 交互实测。 | **排除**旧 `Ctrl+K` 重复修复；残余快捷键线索归入第 8 节延期候选（未独立复核）。 |

### 4.3 待运行时验证 / 未独立复核 / 待产品决定（Deferred / Needs Verification）

- **真实浏览器多标签 `pagehide` 与 IndexedDB 调度**、**真实 Cloudflare D1 / Worker 端到端行为**、**原生 XMind 客户端兼容性**、**真实浏览器 TipTap 点击 / `Shift+Enter` / 剪贴板粘贴与图片 MIME 行为**。
- **`topic.href.target` 协议纵深校验**：已证实 `CanvasDock.tsx:248-255`、`schema.ts:118-123` 未限制协议且 `TopicCard.tsx:446-455` 渲染 `<a href>`，但 React DOM 19.3.1 内含 `javascript:` URL 防护，未证实脚本可执行 → 归入第 8 节延期纵深安全候选，不包装为已确认漏洞。
- **工作区请求串行加载**（`apps/web/src/WorkspaceApp.tsx:90-119, 196`）：代码串行事实已证实，但无实测耗时增益且与 T1 共享加载与列表聚合状态边界 → 归入第 8 节延期性能候选。
- **其余未独立复核 / 待产品决定线索**：见第 8 节（含 Library/Shared 筛选同步、viewer 工作区 CommandK 403、`ViewerEditor` `readOnly` 透传、PR #27 Demo AI 产品意图、`wrangler.jsonc` `workers_dev: true` 等）。

### 4.4 已修复 / 不成立（Resolved / Invalidated）

- **“所有结构命令均不维护概要”**：不成立（反证：`reducer.ts:185-199` `addSibling` 与 `reducer.ts:85-116, 215-246` `delete` 已有局部维护，定向测试证实 `addSibling` 平移合法）。
- **“登录页/工作区 `Ctrl+K` 与编辑器双面板冲突”**：已修复（反证：`App.tsx:55-67` 登录态与工作区互斥，`WorkspaceApp.tsx:131, 137` 已加 `!mapId`，编辑器 `CommandK.tsx:52-63` 仅在编辑态挂载）。
- **“TipTap 坏稿在页面刷新后立即永久删除”**：不准确（反证：补核 `fake-indexeddb` 实测证实原始记录仍保留在 IDB 中，真实缺陷是 `loadLocal` 失败后 `cacheReadable=false` 且普通 UI 缺乏原始记录加载/导出恢复入口）。
- **“清除图片后造成永久不可恢复的 413”**：不准确（反证：是残留未引用资产触发的客户端/服务端 1 MiB 413，可通过安全资产 GC 或缩减文档恢复）。

---

## 5. 五轮双向实质讨论纪要与决议演进

本方案由架构师与实现方围绕冻结基线 `origin/main@7fc979c051b7c7ec33be1c22da6d5184ab450d03` 完整完成 **5 轮实质双向讨论**（含第 3 轮接续修正），以下忠实记录每轮双方主张、核心异议/反证与共同决议：

### 第 1 轮：冻结基线、证据门槛、优先级与任务独立性
- **架构师主张**：以不可变远端 `main` SHA（`7fc979c`）为唯一基线，旧 `0c483e9` 发现仅作线索；只有具备当前版本触发条件、可见影响与源码/验证证据的问题才能进入修复任务；按数据丢失 → 非法文档 → 同步/格式往返 → 性能 → 交付流程排序；每个任务必须可从当时 `main` 独立实现、测试与回滚，共享同一状态机的候选应合并而非硬拆。
- **实现方回应与异议**：
  1. 补充实施期每个任务切分支前须做基线重核，记录 `base/head SHA`。
  2. 建议将证据门槛细化为四分类账本（Confirmed / Partially Fixed / Needs Runtime Verification / Resolved-Invalidated），避免旧问题换名复用或无证据盲改。
  3. **异议**：反对将所有交付护栏与测试基线缺口机械垫底，主张高危误操作护栏或削弱测试可信度的基线缺口可按风险与杠杆合理前置。
  4. **补充防过度合并边界**：仅当拆分会导致后一 PR 重写前一 PR 同一状态转换逻辑时才合并；XMind、OPML 等独立边界必须分离。
- **第 1 轮共同决议**：采纳四分类门槛、杠杆优先级微调（且业务 PR 不得依赖未合并护栏 PR）、按行为契约与可独立回滚界定拆分边界；核实并记录 GitHub `main` 分支保护事实（`Verify`、`strict=true`、`enforce_admins=true`）。

### 第 2 轮：概要覆盖语义、结构编辑不变量与独立 IO 契约
- **架构师主张与证据**：基于 7 项定向内存验证与源码核对，定向核心测试实测证实 `addSibling` 合法平移及 `reparent`/`indent`/`outdent` 产生 `INVALID_SUMMARY_RANGE`，源码静态分析同时指出 `delete` 已有局部维护、`reorder`/`detachToFloating` 会导致覆盖语义错位且 Worker 校验链路会返回 422（静态推断）；主张本项定 P1、不迁移现有 `parentId + [startIndex, endIndex]` 格式、不放宽服务端校验；反对截断区间，倾向在形成非连续/跨父时原子拒绝并给编辑器反馈；提出三类最小语义（部分移出收缩、全员同父连续是否迁移、浮出/非连续拒绝），并要求 XMind 保持独立 IO 任务。
- **实现方回应、结构证明与新增证据**：
  1. **结构反证**：在单节点移动命令下，从连续区间移出单个节点后剩余成员必然连续，真正破坏连续性的仅限同父 `reorder`、跨父 `reparent` 插断区间内部以及单成员 `detachToFloating`。
  2. **三类确定语义**：部分移出自动收缩；单成员/整组移至常规新父且连续时**迁移概要绑定**（反例证明：拒绝单成员移动会导致加概要后节点无法升降级，删除则会静默丢概要内容）；`reorder`/跨父插断及单成员 `detachToFloating` 原子拒绝并轻提示（`addSibling` 延续现行并入行为，已有子树插断则拒绝防误吞）。
  3. **补充发现**：提出 `doc/replaceSheetRoot`、`cascadeCleanup` 折叠概要子树泄漏、`relationship/upsert` 颜色未归一化，以及 TipTap 高亮/粘贴 422、图片 MIME/资产 GC、超链接协议线索。
- **第 2 轮共同决议**：采纳三类概要语义并明确“拒绝命令必须零副作用（不变文档、不入撤销历史、不标 dirty、不写/广播 Loro）”；概要任务定 P1；`replaceSheetRoot` 与 `cascadeCleanup` 经架构师独立补核证实后并入结构引用任务，但 `relationship/upsert` 划归输入契约任务（不单凭同文件并入树变换）；TipTap/媒体/链接留待补核后于第 4 轮定级定范围；XMind 严格独立。

### 第 3 轮（含接续修正）：本机持久化、409 与远端不可用恢复策略
- **架构师主张**：将多标签草稿覆盖、远端不可用与坏缓存恢复合并为统一持久化状态机任务（P1，不混入并行加载或 CRDT 重写）；必须物理分离“云端已确认版本”与“各编辑实例未确认草稿”；区分本机新建、远端不可用（不可假报 `synced` 亦不可断言必为删除）、网络失败/列表缺项、dirty/冲突稿、坏原始记录五类状态；迁移不先删原件且回滚可恢复。
- **实现方初版方案**：提出拒绝纯锁与 `sessionStorage`/`BroadcastChannel` 依赖，采用保持 `DB_VERSION = 1` 的键前缀分离（`v2:synced:` / `v2:draft:<writerId>` / `v2:corrupt:` + 兼容旧键）、内存一次性 `writerId`、上传前快照四元组 + 确认事务内 `localGen`/`revision` CAS、不自动静默删除 clean 缓存。
- **架构师第 3 轮接续提出 4 项关键反例与纠偏**：
  1. **活跃 Writer 冲突**：初版同时声称“不触碰他页键”和“新页认领唯一草稿落盘后删旧 writer 键”自相矛盾——扫描 IDB 无法证明旧 writer 已退出，可能抹掉活跃旧页正在防抖的新编辑。
  2. **普通 `flush` 与因果基线漏洞**：不仅上传确认要 CAS，普通防抖 `flush` 也须防旧 `gen` 覆盖新 `gen`、防携带旧 `baseRevision=1` 的迟到 `flush` 回退已确认的 `baseRevision=2`，且 `await` IDB 提交后标 UI `synced` 前必须重核 `closed`/`owner`/`localGen`；绝不借用他页 `synced.revision`。
  3. **回滚真实可用性反例**：保持 `DB_VERSION = 1` 仅避免 `VersionError`，旧 UI 看不到 `v2:` 键；必须实测旧版读取器面对混合库不崩溃且不误把 `v2:corrupt`/`v2:migrated` 当正常导图，且回滚前/后均须提供经过测试验证的实际只读原件导出通道；迁移标记须按 `(sourceKey, sourceFingerprint)` 幂等，键结构与记录体字段双重隔离。
  4. **鉴权边界与锁论证纠偏**：不新增自定义鉴权头，`session` 与 D1 权限仍是唯一权威；同时纠正“任何单写者锁都防不住双写”的过强表述（覆盖全生命周期的排他锁可防双写，选用独立草稿是为了兼顾多标签编辑与恢复体验）。
- **实现方全盘采纳并收束**：取消自动删除他页 writer 记录（仅复制为新 `writerId` 草稿、UI 显示层去重、仅自身精确确认或用户显式放弃加 `(localGen, fingerprint)` CAS 可删）；补齐全路径 CAS、因果水位（防已确认草稿被迟到旧 `flush` 写活）与 `await` 后重核；纳入旧版读取器混合库测试与回滚只读导出工具函数测试；保持服务端鉴权不变。
- **第 3 轮共同决议**：以修正后的双通道持久化协议、因果水位与可验证回滚通道收束为 T1（P1）。

### 第 4 轮：IO、输入契约、资产生命周期与范围取舍
- **架构师主张**：结合 1+5 项补核证据（修正坏缓存“非永久丢失”、残留资产“非永久 413”、`href` 未证可执行、浏览器验证未完成），收敛为 7 项独立任务；请实现方裁定图片/资产定 P1 还是 P2、OPML 合成根语义、XMind 承诺边界，并建议排除旧 `Ctrl+K`、延期 `href`、延期工作区并行加载、反对无具体验收的通用测试大基建。
- **实现方回应与精准修正**：
  1. **媒体/资产定级**：论证文件选择已有 `accept` 约束、剪贴板非白名单 MIME 与大图残留 413 影响面低于前 3 项 P1，主张定为 **P2**。
  2. **XMind 三层边界**：原生字段优先 + 版本化 `loomind:v1` 扩展边界（仅承诺自往返，不承诺第三方客户端编辑后无损，真实客户端未测）+ 导入强制 schema/invariants 门禁。
  3. **OPML 单根保护边界**：0 根明确报错；1 根严格保留原 `text`（即使 `<head><title>` 不同也不改写）；多根按原顺序挂合成根（`<head><title>` 优先，否则固定默认名）。
  4. **T7 最小化**：明确不动 `wrangler.jsonc`（`workers_dev: true` 留作后续运维核查）。
  5. **新增 1 项独立高证据小任务（T8，P2）**：指出 `apps/web/test/*` 脱离 `pnpm typecheck` 是已有配置证据的明确缺口，范围极小且零前置依赖，提请纳入为第 8 项任务；同意排除旧 `Ctrl+K` 并延期 `href`、并行加载、通用大基建及其他 UI/AI 线索。
- **第 4 轮共同决议**：采纳媒体 P2、XMind 三层契约、OPML 边界、不动 `wrangler.jsonc`；纳入 **T8（Web 测试 typecheck，P2）**，并纠正 T8 表述为“以真实 `tsc` 诊断为准，不预先假定四参 mock 必报错”；进一步将 **T7** 收敛为仅处理 `apps/web/package.json` `deploy` 入口与 `docs/DEPLOYMENT.md`/文档引用，不改动 `.github/workflows/deploy-production.yml` 逻辑；其余 UI/AI 线索一律记为“未独立复核/待产品决定”延期项。

### 第 5 轮：8 任务执行表、验证门槛与逐 PR 审查合并流程
- **架构师主张**：提出 T1–T8 完整执行表、共享文件诚实说明、推荐串行顺序（`方案 PR → T8 → T3 → T1 → T2 → T5 → T6 → T4 → T7`）、方案文档路径 `docs/OPTIMIZATION_PLAN_2026-11-26.md` 及自足/诚实规范、以及 6 条逐 PR 审查与合并硬门槛。
- **实现方回应与执行期防阻塞边界**：确认全部 8 任务范围、T7 最小边界、实施顺序、文档规范与 `--squash --match-head-commit <full-head-sha>` 合并方式；同时提前暴露两处执行条件供对齐：锁文件默认冻结策略，以及 T3 在本地无 Playwright/浏览器受限环境下的交互验证口径。
- **第 5 轮共同决议与两项明确裁定**：
  1. **依赖策略**：默认复用既有依赖并以 `--frozen-lockfile` 安装；**不设**“全批必须零 lockfile 变更”的硬限制——若某任务关键验收确需一个小型测试依赖，可在对应 PR 附说明与准确 lockfile 变更提审，不因自设限制放弃关键验收（演变为大型测试基建时则停下复核范围）。
  2. **真实 UI/剪贴板验收口径**：不预设“绿 `Verify` 加一句未覆盖即可合并”；先用受允许的本地测试通道或最小必要测试依赖完成实际 TipTap/组件/浏览器边界验证；若确遇客观环境阻塞，如实报告具体原因并继续推进其他独立任务，绝不绕过限制，也不冒充通过。
  3. 正式确认 5 轮讨论收束，先交付并审查合并本方案 PR，再按顺序逐任务实施。

---

## 6. 八项独立可执行任务总表与详细规格

### 6.1 任务总览与实施顺序

**建议串行顺序**：`方案 PR → T8 → T3 → T1 → T2 → T5 → T6 → T4 → T7`

> 说明：`T8` 优先仅因其改动小、能尽快补齐 Web 测试类型检查缺口，**并非**其他任何任务的技术前置；若 `T8` 实施中出现超出预期的基础设施扩散，立即暂停复核范围，绝不阻塞 P1 修复。每个任务均严格基于当时最新 `origin/main` 建独立分支与 target `main` PR，互不依赖未合并 PR 的代码或契约。

| ID | 优先级 | 任务名称 | 核心修改边界 | 共享文件说明（零代码依赖） |
|---|---|---|---|---|
| **T8** | P2 | Web 测试类型检查补齐 | `apps/web/test/tsconfig.json`、`apps/web/package.json`（`typecheck`）、`apps/web/test/*.ts` 既有类型修正 | 与 T1 共享 `apps/web/test/workspace.test.ts`；与 T7 共享 `apps/web/package.json` 不同 script 字段 |
| **T3** | P1 | 富文本与命令输入契约 | `packages/editor/src/canvas/TopicEditor.tsx`、`TopicCard.tsx`、`packages/core/src/store/reducer.ts`（`relationship/upsert`）、对应测试 | 与 T2/T4 共享 `reducer.ts` 不同命令段 |
| **T1** | P1 | 草稿隔离、远端不可用与原件恢复 | `apps/web/src/persistence.ts`、`apps/web/src/drafts/*`、`AccountControl.tsx`、`WorkspaceApp.tsx`（仅本地列表映射与安全 legacy 迁移）、`i18n.ts`、`apps/web/test/workspace.test.ts`、独立只读回滚恢复产物与手册 | 与 T8 共享 `apps/web/test/workspace.test.ts` |
| **T2** | P1 | Core 结构命令与引用完整性 | `packages/core/src/store/reducer.ts`（移动/替换根/级联）、`invariants.ts`、最小拒绝通知契约、`packages/editor/` 最小拒绝轻提示、核心与适配器测试 | 与 T3/T4 共享 `reducer.ts` 不同命令段 |
| **T5** | P1 | XMind 导入导出保真与兼容说明 | `packages/core/src/io/xmind.ts`、`packages/core/test/xmind.test.ts`、必要兼容说明 | 独立专用测试文件，不重排既有共用测试 |
| **T6** | P1 | OPML 多顶层导入保全 | `packages/core/src/io/opml.ts`、`packages/core/test/opml.test.ts`、必要兼容说明 | 独立专用测试文件 |
| **T4** | P2 | 图片 MIME 校验与资产生命周期 | `packages/editor/src/canvas/HybridCanvas.tsx`、`CanvasDock.tsx`、`packages/core/src/store/reducer.ts`（全文档零引用资产 GC）、提示与测试 | 与 T2/T3 共享 `reducer.ts` 不同命令段 |
| **T7** | P2 | 受支持的发布入口与文档一致性 | `apps/web/package.json`（`deploy` 字段）、`docs/DEPLOYMENT.md` 及必要文档/脚本引用 | 与 T8 共享 `apps/web/package.json` 不同 script 字段 |

---

### 6.2 逐任务详细规格

#### T8（P2）：Web 测试类型检查补齐
- **证据**：`apps/web/tsconfig.json:8`、`apps/web/worker/tsconfig.json:8`、`apps/web/package.json:13`（排除 `apps/web/test/*`）。
- **范围**：新增独立 `apps/web/test/tsconfig.json`（`lib`/`target` 与实际测试运行时一致，不扩大生产编译目标）；接入 `apps/web/package.json` 的 `typecheck` 脚本使 CI `Verify` 覆盖 `apps/web/test/*`；先运行真实 `tsc` 采集基线诊断，再仅修正真实编译报错。
- **不包含**：不删除任何现有测试断言、不用 `any` 兜底或关闭严格检查掩盖错误、不改动业务运行时行为、不引入大型测试框架。
- **验收标准**：
  1. PR 描述中附上接入 `apps/web/test/tsconfig.json` 后的**真实原始 `tsc` 诊断输出**（不凭静态猜测提前宣称特定四参 mock 必报错）；
  2. 修正后 `pnpm typecheck` 实际检查并覆盖 `apps/web/test/worker.test.ts` 与 `apps/web/test/workspace.test.ts`（可验证故意注入测试文件类型错误会被拦截）；
  3. 既有测试行为与断言完整保留并全部通过。
- **实施期必过验证命令**：
  - `pnpm install --frozen-lockfile`
  - `pnpm --filter @mindmap/web exec tsc -p test/tsconfig.json --noEmit`
  - `pnpm typecheck && pnpm test && pnpm build`
- **风险与回滚**：风险为错误放宽生产 `tsconfig` 的 `lib` 或误改测试逻辑；回滚仅需撤销新增 `test/tsconfig.json`、`package.json` `typecheck` 调整及对应类型标注。

#### T3（P1）：富文本与命令输入契约
- **证据**：`packages/editor/src/canvas/TopicEditor.tsx:22-46, 61-74, 157-164`、`TopicCard.tsx:48-69`、`packages/core/src/model/schema.ts:5-8, 55-64, 169-182`、`packages/core/src/store/reducer.ts:546-564`。
- **范围**：
  - `TopicEditor` 进出 TipTap 双向转换归一化：颜色统一为 canonical 8 位大写 `#RRGGBBAA`，打通 `highlight` 的 `color`/`backgroundColor` 映射确保重进编辑与 `TopicCard` 渲染一致；
  - 将 `hardBreak` 转换为已有文档模型可表示的换行，绝不静默丢文本；
  - 处理粘贴带来的 `rgb(...)`、`#rrggbb`、小写 hex、`null` 属性等非法 mark，过滤未知/非法属性同时保留合法内容；
  - `packages/core/src/store/reducer.ts` 中 `relationship/upsert` 补齐 `normalizeHexColor()`（如实注明普通 UI 6 位关系色入口未证实，属命令契约一致性加固）。
- **不包含**：不放宽 `MindmapDocumentSchema` / `RichTextMarkSchema`、不改存储结构与 IndexedDB 迁移、不混入树结构/概要移动逻辑、不改动图片/超链接协议。
- **验收标准**：
  1. 真实 TipTap 2.27.3 扩展与 `normalizeTipTapJson` 进出往返测试覆盖：高亮默认色与自定义色、重进编辑格式保留、`rgb`/`null`/6 位 hex 粘贴、`hardBreak` 换行保全；
  2. 所有输出经真实 `LocalImmerSyncAdapter` / `LoroSyncAdapter`、`MindmapDocumentSchema.safeParse` 与 `validateDocumentInvariants` 全部通过；
  3. `relationship/upsert` 6 位/小写颜色归一化与非法色边界单测通过；
  4. **交互边界验证**：优先使用受允许的本地测试通道或最小必要 DOM/组件测试依赖验证实际 TipTap 编辑器实例高亮、`Shift+Enter` 与粘贴转换行为；若真实浏览器环境仍受限，必须如实列出阻塞原因，不得以绿 `Verify` 冒充真实浏览器手测通过。
- **实施期必过验证命令**：
  - 专用定向测试（`packages/editor/test/` 与 `packages/core/test/` 新增/补充测试）
  - `pnpm typecheck && pnpm test && pnpm build`
- **风险与回滚**：风险为双向字段映射不一致导致重进编辑器丢失既有高亮或换行错位；回滚仅撤销转换函数、渲染映射与颜色归一化，不破坏既有合法文档。

#### T1（P1）：草稿隔离、远端不可用与原件恢复
- **证据**：`apps/web/src/persistence.ts:7-9, 28-67`、`apps/web/src/drafts/workspace.ts:48-144`、`apps/web/src/WorkspaceApp.tsx:90-119`、`apps/web/worker/drafts.ts:40-44, 90-108`、`apps/web/src/auth/AccountControl.tsx:34-57`。
- **范围**：`apps/web/src/persistence.ts`、`apps/web/src/drafts/workspace.ts`、`apps/web/src/drafts/cloud.ts`（仅状态分类）、`apps/web/src/auth/AccountControl.tsx`（及最小恢复条 UI）、`apps/web/src/WorkspaceApp.tsx`（仅本地缓存列表聚合/状态标记与幂等 legacy 迁移）、`apps/web/src/i18n.ts`、`apps/web/test/workspace.test.ts`，以及随 T1 独立交付的一份经审查的**独立零依赖只读浏览器恢复脚本/片段、校验和（如 SHA-256）与操作手册**（存放于独立于新版前端 bundle 的不可变已审提交/独立恢复文档中，本方案文档仅定义规格、不在此处附带脚本实现）。
- **核心设计约束（第 3 轮终版决议）**：
  1. **存储与键隔离**：保持 `loomind-db` `DB_VERSION = 1`（`docs` store），采用编码定界键 + 记录体 `{ schema: 2, kind, owner, mapId, writerId? }` 双重校验隔离四类记录：`v2:synced`（云端已确认快照）、`v2:draft`（按内存一次性 `writerId = crypto.randomUUID()` 隔离的实例草稿，绝不存 `sessionStorage`）、`v2:corrupt`（坏原始记录只读隔离区）、`v2:migrated`（按 `(owner, sourceKey, sourceFingerprint)` 幂等记录，防止重复复制坏记录或删空后复活未变更 legacy 稿）；旧单键 `google:${owner}:${id}` 只读兼容迁移、永不先删。
  2. **活跃 Writer 保护**：绝不自动删除其他 `writerId` 的草稿；认领恢复仅复制到新实例自己的 `writerId` 键；相同内容仅在 UI 层合并展示；其他 `writerId` 仅可由其自身精确上传确认清理，或由用户显式选中放弃并在事务内用 `(expectedLocalGen, expectedContentFingerprint)` 做 CAS 校验（若已更新则中止删除并提示）。
  3. **全路径 CAS、因果水位与草稿清理解耦及 `await` 重核**：
     - 普通防抖 `flush` 在 IDB 事务内执行 `localGen` CAS 与本 `writerId` 因果水位校验（`ackedGen` / `confirmedBaseRevision`），拒绝迟到旧 `gen` 覆盖新记录或把已确认清理的草稿重新写活；草稿写入的基线单调不降（取 `Math.max(flushBaseRevision, confirmedBaseRevision)`），绝不回退，也绝不借用他页 `synced.revision`；
     - 上传前捕获不可变四元组 `{ writerId, sentGen, baseRevision, docSnapshot }`，收到该次上传确认（`sentGen -> newRevision`）后，在确认事务内对 `v2:synced` 执行 `existing.revision < newRevision` CAS，并将因果水位推进与草稿清理**严格解耦为两步**：
       - **步骤 A（本 `writerId` 收到 `sentGen -> newRevision` 确认时恒执行）**：单调推进本 `writerId` 独立的已确认因果水位（`ackedGen = Math.max(ackedGen, sentGen)`）与已确认因果基线（`confirmedBaseRevision = Math.max(confirmedBaseRevision, newRevision)`），绝不借用其他 `writerId` 的 `synced.revision`；若存储或内存中已存在因果建立在 `sentGen` 之上的更新编辑（`gen2 > sentGen`），**完整保留 `gen2` 的 dirty 内容不被触碰或覆盖**，同时将其因果基线安全推进至 `newRevision`，确保 `gen2` 后续 flush/上传基于 `r2` 重试而非与旧 `r1` 自撞 409；
       - **步骤 B（仅当不存在更新本地编辑时执行）**：**仅当**事务内满足 `stored.localGen === sentGen` 且 `await` IDB 提交后重核确认 `!closed && owner === reqOwner && this.localGen === sentGen` 时，才删除本 `writerId` 的待同步草稿并将 UI 状态切换为 `synced(newRevision)`；否则保持 `gen2` 为 dirty 状态并调度下一次上传。
  4. **五类状态语义**：本机新建（`rev=0`）待首次同步；远端不可用（clean/dirty 遇到单图 `GET` HTTP 200 `{0, null}`）绝不假报 `synced`、不自动删 clean 缓存、打破 dirty 409 死循环、提供另存新图（新 ID `rev=0`）/导出/显式移除（移除 clean 前事务内确认无 pending draft）、绝不自动用旧 ID 重建远端；离线/网络失败与列表 API 缺项绝不等同不可用；坏原始记录隔离到 `v2:corrupt` 并提供原样 JSON 下载与显式丢弃，IDB 配额/不可读错误明确提示未持久化并保留内存导出。
  5. **鉴权不变**：不改动服务端鉴权契约，不新增自定义鉴权头，以服务端 session 与 D1 权限为唯一权威。
- **不包含**：不混入工作区并行加载性能优化、不做 CRDT 重写、不改文档 schema 或放宽校验、不改服务端 API 权限边界、不做生产清库或 D1 迁移。
- **验收标准**：
  1. 真实共享同一 `fake-indexeddb` 实例的双 `DraftWorkspace` 交错测试：胜者回写分别发生在 409 前/后、刷新重建（新 `writerId`）完整恢复分歧稿；
  2. 并发与乱序测试：普通防抖旧 `gen` 乱序落盘被拒；**`gen2` 已在 `gen1 -> r2` 确认到达前存在**时，确认推进因果水位/基线至 `r2` 且完整保留 `gen2` dirty 内容、后续以 `r2` 同步不自撞 409；迟到 `gen2(base=1)` `flush` 既不回退已确认基线也不覆盖更新编辑；`gen1` 确认清理后迟到旧 `gen1` `flush` 不写活已清理草稿；**重载/重启后 `gen2` 仍完整保留并可基于 `r2` 恢复/同步**（测试须校验中间持久化状态、因果基线与文档内容，**明确不得仅断言最终 `revision`**）；`await` 提交期间新编辑/关闭/切账号防误标 `synced`；乱序 `r2`/`r3` 确认不回退 `synced`；显式放弃草稿的 CAS 中止；
  3. 状态与异常测试：新建 `rev=0`、clean/dirty 远端不可用、离线/失败、列表缺项保留、坏记录隔离与原样导出、`QuotaExceededError`/不可读提示、跨账号隔离、legacy 幂等迁移不复活；
  4. **回滚可用性与独立只读恢复实测**：在模拟回滚环境（运行现行 `main@7fc979c` 旧版读取器/应用逻辑，面对包含 legacy 旧键与 `v2:synced`/`v2:draft`/`v2:corrupt`/`v2:migrated` 的混合 IndexedDB）中同时完成两项实测：① 验证旧版读取器不崩溃且**绝不误识别**任何 `v2:*` 记录为正常导图；② 在不加载任何 T1 新版应用 UI/模块代码的前提下，实际执行独立零依赖只读恢复制品，验证其通过严格 `readonly` 事务完整导出全部相关 `writer` 草稿与 `v2:corrupt` 原件且对 IndexedDB **零写入/零清理**（明确说明：**仅对新版 UI 内部函数做单元测试不足以证明回滚后的可恢复性**）。
- **实施期必过验证命令**：
  - `pnpm vitest run apps/web/test/workspace.test.ts`
  - `pnpm typecheck && pnpm test && pnpm build`
- **风险与回滚**：风险为跨标签边界竞态、键编码兼容或紧急回滚后旧 UI 不展示 `v2:` 记录；回滚时严禁清理 IDB 中 `v2:` 键，回滚前可通过新版 UI 导出全部未同步/冲突/坏原件；紧急回滚后的可获取、可执行只读恢复路径须满足三项规格：① **产物与获取来源**：T1 随 PR 交付独立零依赖只读浏览器恢复脚本/片段、校验和（如 SHA-256）及操作手册，存于独立于新版前端 bundle 的不可变已审提交/独立恢复文档中，回滚时可单独留存或直接自该不可变已审提交/tag 取得并校验后使用；② **触发与执行域**：由用户/操作员在原应用源（origin）的浏览器 DevTools Console 中直接执行，无需加载任何新版应用 UI 代码；③ **只读行为与输出**：严格以 `readonly` 事务打开 `loomind-db` / `docs` store，读取全部 `v2:draft`、`v2:synced`、`v2:corrupt`、`v2:migrated` 记录并导出为本地 JSON 下载/输出，严格**永不写入或清理 IndexedDB**。未覆盖边界（真实浏览器多标签 `pagehide` 与真实 D1）须在 PR 报告中如实注明。

#### T2（P1）：Core 结构命令与引用完整性
- **证据**：`packages/core/src/store/reducer.ts:85-116, 171-175, 249-325`、`packages/core/src/model/invariants.ts:90-120`。
- **范围**：`packages/core/src/store/reducer.ts`、`packages/core/src/model/invariants.ts`、`packages/core/src/store/sync-adapter.ts`、`packages/core/src/store/loro-adapter.ts`、`packages/core/src/store/store.ts`（最小拒绝结果通知）、`packages/editor/`（极小范围拒绝原因轻提示）、`packages/core/test/` 与对应编辑器/适配器测试。
- **核心设计约束（第 2 轮终版决议）**：
  1. 严格保留现有 `parentId + [startIndex, endIndex]` 概要格式，不迁移文档格式、不放宽服务端校验；
  2. **三类概要移动确定语义**：
     - 部分覆盖成员移出源父 → 源概要收缩至剩余连续成员区间；
     - 单成员或全部覆盖成员移入同一常规新父且连续 → 迁移概要绑定（更新 `parentId` 与新区间，完整保留 `summary.topic` 及子树）；
     - 同父 `reorder` / 跨父 `reparent` 插断覆盖连续性（`addSibling` 新增空白节点延续并入规则，已有子树插断则拒绝），或单成员概要 `detachToFloating` 无法表达合法 `parentId` → **原子拒绝变更并返回结构化原因供编辑器轻提示**；
  3. **拒绝零副作用**：拒绝的命令绝不修改文档、不入撤销历史、不标 dirty、不触发通知、不写入或广播 Loro；
  4. **`replaceSheetRoot` 与级联清理**：按“实际消失的 ID 集合”执行固定点递归清理（保留新树重用的 `root.id`、浮动主题及其合法关系/概要/边界，绝不清空整个 sheet 或误 tombstone 重用 root ID）；失效概要的 `id` 与 `summary.topic` 子树递归纳入清理集合；核对并在 `invariants.ts` 补齐 `boundary` 目标节点存在性校验；
  5. 历史坏文档禁止在读取/保存时静默裁剪“修好”，保持严格校验并保留原件可导出。
- **不包含**：不含 `relationship/upsert` 颜色归一化（归 T3）、不含 `doc.assets` GC（归 T4）、不含 XMind/OPML 编解码（归 T5/T6）、不改服务端校验逻辑。
- **验收标准**：覆盖 `addSibling`/`delete`/`indent`/`outdent`/`reparent`/`reorder`/`detachToFloating`/`replaceSheetRoot`、嵌套概要与概要作父、浮动合法引用保全、`boundary` 悬空断言、拒绝零副作用、`undo`/`redo`、`LocalImmerSyncAdapter` 与 `LoroSyncAdapter` 双适配器一致性，所有合法操作后 `validateDocumentInvariants(doc) === []` 且覆盖成员身份集合精确匹配。
- **实施期必过验证命令**：
  - `pnpm vitest run packages/core/test/core.test.ts packages/core/test/loro.test.ts`（及本任务新增测试）
  - `pnpm typecheck && pnpm test && pnpm build`
- **风险与回滚**：风险为拒绝通知兼容现有 `applyCommand` 调用方及 `LoroSyncAdapter` 同步一致性；回滚仅撤销命令/拒绝实现与新增校验，不销毁用户文档。

#### T5（P1）：XMind 导入导出保真与兼容说明
- **证据**：`packages/core/src/io/xmind.ts:38-179`、`packages/core/src/model/document.ts:251-288`。
- **范围**：`packages/core/src/io/xmind.ts`、专用测试文件 `packages/core/test/xmind.test.ts`、必要导入导出兼容边界说明。
- **核心设计约束（第 4 轮终版决议）**：
  1. **原生字段优先**：布局/方向映射 XMind 原生 `structureClass`，概要按实际 `parentId` 写到对应父节点并在导入时恢复真实 `parentId`（不再扁平挂载至 `rootTopic`），保留并映射 `topic.task`、`notes`、`markers`、`floatingTopics`、`relationships` 与多 sheet；
  2. **版本化扩展命名空间**：仅对 XMind 原生无法无损表达的 Loomind 属性采用版本化扩展命名空间（如 `loomind:v1`），并明确声明：**仅承诺 Loomind 自导出↔导入在声明字段上的保真，不宣称经第三方 XMind 客户端编辑后扩展属性仍无损，原生 XMind 客户端兼容标为“未验证”**；
  3. **导入强制门禁**：导入产物必须通过现有 `MindmapDocumentSchema.safeParse` 与 `validateDocumentInvariants`（对外部非法 ID/超长标签做确定性消毒或明确报错，绝不返回非法文档）。
- **不包含**：不改 `packages/core/src/store/reducer.ts` 或概要数据契约、不改 OPML（归 T6）、不依赖 T2 未合并代码。
- **验收标准**：在专用 `packages/core/test/xmind.test.ts` 中断言多 sheet、各布局/方向、`task`（`todo`/`done`）、根与嵌套子分支概要的 `parentId` 及成员身份、`notes`/`markers`/`floating`/`relations` 往返；覆盖来源清晰的外部结构 fixture、旧版 Loomind 导出样本、非法/畸形输入，且所有导入结果均通过 schema 与 invariants 校验。
- **实施期必过验证命令**：
  - `pnpm vitest run packages/core/test/xmind.test.ts packages/core/test/io.test.ts`
  - `pnpm typecheck && pnpm test && pnpm build`
- **风险与回滚**：风险为外部 XMind 版本差异或旧导出兼容回归；回滚仅还原 `xmind.ts` 编解码实现，保留用户原始 `.xmind` 文件。

#### T6（P1）：OPML 多顶层导入保全
- **证据**：`packages/core/src/io/opml.ts:54-93`。
- **范围**：`packages/core/src/io/opml.ts`、专用测试文件 `packages/core/test/opml.test.ts`、必要说明。
- **核心设计约束（第 4 轮终版决议）**：
  1. **0 顶层 / 空文档 / 无合法 `<outline>`**：明确抛出可理解的导入错误，不静默丢节点或生成误导空图；
  2. **1 个顶层 `<outline>`**：严格保持现有单根行为，**即使 `<head><title>` 存在且文本不同也不改写单顶层标题**；
  3. **≥2 个顶层 `<outline>`**：按原始顺序挂入一个合成根节点下，合成根标题优先取非空 `<head><title>`，否则采用固定可说明默认名，且不改动原有各顶层节点文本、层级与 `_note`；
  4. 支持单/双引号属性、自闭合、嵌套、常见 XML 实体转义与畸形输入报错，导入结果通过 `MindmapDocumentSchema` 与 `validateDocumentInvariants`。
- **不包含**：不含 XMind、不做通用全功能 XML 解析器重写。
- **验收标准**：在专用 `packages/core/test/opml.test.ts` 覆盖单根往返、单根含不同 `<head><title>` 不改名、多顶层按序保全（含/不含 `<head><title>`）、单双引号、自闭合、多层嵌套、XML 实体转义、`_note` 与畸形/空输入报错。
- **实施期必过验证命令**：
  - `pnpm vitest run packages/core/test/opml.test.ts packages/core/test/io.test.ts`
  - `pnpm typecheck && pnpm test && pnpm build`
- **风险与回滚**：风险为影响单根兼容或特殊 XML 方言；回滚仅还原 `opml.ts`，保留用户原始 `.opml` 文件。

#### T4（P2）：图片 MIME 校验与资产生命周期
- **证据**：`packages/editor/src/canvas/HybridCanvas.tsx:454-484`、`CanvasDock.tsx:129-155, 176-181`、`packages/core/src/model/schema.ts:206-213`、`packages/core/src/store/reducer.ts:491-500`、`apps/web/src/drafts/cloud.ts:40-45`。
- **范围**：媒体进入边界（剪贴板粘贴与文件选择统一校验）、`packages/core/src/store/reducer.ts` 中 `setImage` 清除/替换及节点/概要删除后的全文档零引用资产 GC、必要拒绝提示与测试。
- **核心设计约束（第 4 轮终版决议）**：
  1. 写入文档前显式校验 MIME 白名单（`image/png`、`image/jpeg`、`image/webp`、`image/svg+xml`），对不支持类型原子拒绝并给出可见提示，保持原文档零副作用（**不扩展 schema、不静默转码丢动画**）；
  2. 资产回收必须遍历**全部 sheet 的 `rootTopic` 子树、`floatingTopics` 与 `summary.topic` 子树**，仅删除全图引用计数为 0 的 `doc.assets` 条目，严格保留被多节点共享的资产，且与 `undo`/`redo` 原子一致；
  3. 如实定位为“可恢复的残留资产触发客户端/服务端 1 MiB 413”，不改服务端 1 MiB 限制。
- **不包含**：不扩展 `InlineAssetSchema`、不做图像转码压缩服务、不改服务端 `DRAFT_LIMIT`、不改概要移动逻辑（归 T2）。
- **验收标准**：覆盖不支持 MIME 原子拒绝且无副作用、清除/替换单节点图片后零引用资产被回收、多节点/跨 sheet/浮动/概要子树共享引用保全、删除含图节点或含图概要后零引用回收、`undo`/`redo` 恢复被回收资产，以及按 **UTF-8 实际字节数** 验证清除大图片后脱离 1 MiB 413 边界。
- **实施期必过验证命令**：
  - `pnpm vitest run packages/core/test/core.test.ts`（及本任务新增媒体/GC 专用测试）
  - `pnpm typecheck && pnpm test && pnpm build`
- **风险与回滚**：风险为漏扫浮动/概要/其他 sheet 引用导致误删共享图片；回滚仅还原 MIME 校验与 GC 逻辑，不删除用户已有资产数据。

#### T7（P2）：受支持的发布入口与文档一致性
- **证据**：`apps/web/package.json:12`、`docs/DEPLOYMENT.md:7, 25, 29`、`.github/workflows/deploy-production.yml:260-265`。
- **范围**：严格最小范围——移除或替换 `apps/web/package.json:12` 直接执行生产 `wrangler deploy` 的误导性 `deploy` 脚本（改为明确拒绝直接本地发布并指向官方 GitHub Actions 发布工作流与经批准应急流程）；按当前实际路由更新 `docs/DEPLOYMENT.md:25` 中过时的“至少检查游客打开编辑器”人工验收条目，并核对相关脚本文档引用；**明确保留 `docs/DEPLOYMENT.md:29` 与 `.github/workflows/deploy-production.yml:260-265` 中仍有效的游客会话（`/api/auth/session`）自动健康/冒烟检查**；仅做无真实部署的只读脚本行为与文档引用核对。
- **不包含**：**不修改** `.github/workflows/deploy-production.yml` 逻辑、**不修改** `apps/web/wrangler.jsonc`（含 `workers_dev`）、**不修改** Cloudflare token/权限、GitHub 环境或分支保护、**绝不执行**任何实际部署或远程 D1 迁移。
- **验收标准**：
  1. 本地无部署执行 `pnpm --filter @mindmap/web deploy`（或替代检查脚本）不会调用 `wrangler deploy`，并清晰输出唯一受支持发布路径说明；
  2. 文档明确声明“移除 npm 脚本仅消除误操作入口，不等于撤销已持有者的 Cloudflare 访问权限”，且完整保留经批准的应急恢复流程说明；
  3. 静态核对 `docs/DEPLOYMENT.md` 与仓库内实际路由/脚本引用一致：`docs/DEPLOYMENT.md:25` 过时的“至少检查游客打开编辑器”条目已按现行路由更新，同时 `docs/DEPLOYMENT.md:29` 与 `.github/workflows/deploy-production.yml:260-265` 的游客会话健康/冒烟检查保持原样不受破坏；**明确不得以搜索仓库中本就不存在的 `/try` 字样作为验收标准**。
- **实施期必过验证命令**：
  - 无部署脚本行为静态/退出验证命令（在 PR 中贴出真实输出）
  - `pnpm typecheck && pnpm test && pnpm build`
- **风险与回滚**：风险为影响既定操作员习惯或应急恢复指引；回滚仅还原 `package.json` 脚本字段与文档文字，保留正式工作流不变。

---

## 7. 逐 PR 审查、验证与合并治理规则

本方案 PR 及后续 T8–T7 全部实现 PR 均严格遵守以下 6 条硬规则：

1. **提审完整凭证**：每个 PR 必须从当时最新 `origin/main` 创建独立分支并 target `main`。提审时提供：完整 PR URL、完整 `base SHA`、完整 `head SHA`、修改文件清单与范围摘要、本地实际执行命令与真实结果、GitHub Actions `Verify` 最终状态，以及任何未覆盖的客观边界。**绝不把“等待 CI”或局部通过当成完成。**
2. **独立审查闭环**：由独立于实现者的架构师逐 PR 检查正确性、边界/安全、回归覆盖、实际测试与 CI。审查发现任何问题必须由实现方修复、推送新 `head`、重跑检查并重新提审；一旦 `head` 变化，此前确认自动失效。
3. **绑定确切 `head SHA` 的合并授权**：仅当架构师重新读取 PR、确认该确切最新完整 `head SHA` 无未解决问题、任务验收与必需检查全部通过且无冲突后，发出明确“可合并（绑定完整 `head SHA`）”确认。
4. **安全合并与零绕过**：合并使用 `gh pr merge <PR号> --squash --match-head-commit <full-head-sha>`，**严禁使用 `--admin`** 或绕过任何分支保护。若 `main` 前进导致满足 `strict=true` 需更新分支，更新分支后须重跑检查并由架构师对新 `head` 重审后再合并。
5. **合并后同步与无部署红线**：合并后立即回报实际 `mergeCommit SHA` 与最新 `origin/main` 状态。合并不等于部署，本批次无任何部署授权。
6. **客观阻塞如实报告**：若关键交互/环境验收因工具或环境限制无法完成，必须如实标明为该任务阻塞或未验证边界，绝不绕过工具/仓库限制，也不以绿 `Verify` 冒充全量通过。

---

## 8. 明确排除与延期候选清单（不在本批实施范围）

### 8.1 已排除（有当前源码反证）
- **旧版 `WorkspaceApp` `Ctrl+K` / `n` 与编辑器双面板冲突**：`apps/web/src/WorkspaceApp.tsx:131, 137` 已通过 `&& !mapId` 守卫修复，`/login` 与工作区互斥（`apps/web/src/App.tsx:55-67`），不重复立项。

### 8.2 已证实但明确延期（避免与本批任务状态机耦合或待实测）
- **工作区加载请求并行化**（`apps/web/src/WorkspaceApp.tsx:90-119, 196`）：代码确为串行 `await`，但与 T1 共享本地缓存/云端列表聚合边界且缺真实网络耗时测量，延期至 T1 合并后以实测收益单独立项。
- **`topic.href.target` 协议纵深校验**（`packages/core/src/model/schema.ts:118-123`、`CanvasDock.tsx:248-255`、`TopicCard.tsx:446-455`）：React 19.3.1 含 `javascript:` 防护，未证实脚本可执行；列为后续安全纵深与 URL 兼容策略候选。
- **生产部署工作流与路由附加运维核查**：`.github/workflows/deploy-production.yml` 额外协作表/401 冒烟检查、`apps/web/wrangler.jsonc:7` `workers_dev: true` 路由核查及线上 Cloudflare 权限/D1 状态检查——需基于运维授权单独核查，不在本批代码 PR 范围内。

### 8.3 未独立复核 / 待产品决定的后续线索（不作为已确认漏洞或本批承诺）
以下为静态全仓核对中观察到的额外源码线索，尚未经双方独立复核或需产品主人明确意图，仅作透明留痕供后续批次评估：
- **PR #27 本地演示 AI 与文档规范差异**：`packages/ai/src/actions.ts`、`packages/editor/src/chrome/AiChatPanel.tsx` 与 `README.md:41` 的产品定位需由产品主人明确方向（保留演示模式、恢复“即将推出”提示或接入真实模型）。
- **独立 UI 状态与快捷键线索**：`/app/library` 与 `/app/shared` 切换过滤状态（`apps/web/src/WorkspaceApp.tsx:355-358`、`LibraryView.tsx:36`）、只读工作区下 `WorkspaceCommandK` 建图入口（`WorkspaceApp.tsx:396-399`）、`ViewerEditor` `readOnly` 向下传递（`packages/editor/src/MindmapEditor.tsx:182-227`）、`MindmapEditor` `Ctrl/Cmd+I` 与 `HybridCanvas` 在 `PitchOverlay`/弹窗下的键盘事件边界、以及 `OutlinerView`/`SheetBar`/`AiChatPanel` IME 与 `Escape` 细节。
- **其他运行时未知项**：浏览器 `pagehide` 异步 IndexedDB 写入可靠性、Turnstile 第 2 步过期恢复、Vector PDF 导出 CJK 字体渲染、`LoroSyncAdapter` 长期定位。
