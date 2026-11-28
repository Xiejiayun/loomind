# Loomind LLM 接入 — 待补全资源与上线配置清单

本文档列出在代码开发阶段**尚未提供、已使用受控 Mock 兜底**的外部资源，以及你后续补齐资源并切换为 100% 真实模型推理的完整步骤。

---

## 1. 待你提供的外部资源清单

| 编号 | 资源名称 | 对应环境变量 / 配置项 | 用途 | 当前开发态替代方案（Mock） | 是否必填（生产） |
|---|---|---|---|---|---|
| **R1** | **自有付费 LLM 代理站地址** | `PRO_LLM_BASE_URL`（Worker Secret / Var） | 已登录 Pro 用户调用的 OpenAI Responses / Chat 兼容接口根地址（已写入本地 `.dev.vars`：`https://aerial.jeremyxie.com/v1`） | 本地 `.dev.vars` 已配置真实地址；线上缺失且 `AI_ALLOW_MOCK=true` 时走 `Pro Mock Provider` | **需写入 Cloudflare Worker Secret** |
| **R2** | **自有付费 LLM 代理站密钥** | `PRO_LLM_API_KEY`（Worker Secret） | 调用代理站的 `Authorization: Bearer <key>` 凭据 | 未配置时 Pro 不可用；只有显式开启演示模式才会返回 Mock | **需写入 Cloudflare Worker Secret** |
| **R3** | **付费模式默认模型名** | `PRO_LLM_MODEL`（Worker Var） | 指定代理站上的强力模型 ID（已在 `wrangler.jsonc` 配置为 `gpt-6.2-sol`，已实测通过 `/v1/responses` 流式返回） | 已配置真实模型名 | **已完成配置** |
| **R4** | **Cloudflare Workers AI 绑定确认** | `wrangler.jsonc` 中 `"ai": { "binding": "AI" }` | `/try` 免费体验页调用 Cloudflare 原生免费 10,000 Neurons/天 推理 | 本地 `wrangler dev --local` 无远端 AI 绑定且 `AI_ALLOW_MOCK=true` 时走 `Free Mock Provider` | **生产自动生效**（确认账户已开通 Workers AI） |
| **R5** | **免费体验默认模型名** | `AI_FREE_MODEL`（Worker Var） | Workers AI 目录中支持流式文本生成的模型 ID | 默认 `@cf/google/gemma-4-26b-a4b-it` | 可选（已有默认值） |
| **R6** | **每日调用配额阈值** | `AI_FREE_DAILY_LIMIT`、`AI_PRO_DAILY_LIMIT` | 控制单 IP 免费体验次数与单登录用户付费调用次数 | 代码默认 `10`（免费） / `100`（付费） | 可选（已有默认值） |
| **R7** | **生产关闭 Mock 开关** | `AI_ALLOW_MOCK`（Worker Var） | 控制缺失上游凭据时是否允许降级为 Mock | 不自动启用；仅本地演示或测试按需设为 `true` | **生产保持 `false`** |
| **R8** | **线上 D1 执行 `0005` 迁移** | `apps/web/migrations/0005_ai_usage.sql` | 创建 `ai_usage_daily` 每日配额限流表 | 本地与单测自动执行；生产发布工作流会自动 apply | **生产必执行** |

---

## 2. 后续补全配置操作步骤

### 2.1 本地真机联调（`apps/web/.dev.vars`）

在本地被 `.gitignore` 忽略的 `apps/web/.dev.vars` 中补充以下变量（参考 `apps/web/.dev.vars.example`）：

```dotenv
# 付费 LLM 代理站（OpenAI 兼容 /v1）
PRO_LLM_BASE_URL=https://你的代理域名/v1
PRO_LLM_API_KEY=sk-你的真实密钥
PRO_LLM_MODEL=你的模型ID

# 可选：自定义免费体验模型与限流
AI_FREE_MODEL=@cf/google/gemma-4-26b-a4b-it
AI_FREE_DAILY_LIMIT=10
AI_PRO_DAILY_LIMIT=100

# 使用真实上游；仅需要测试固定演示数据时改为 true
AI_ALLOW_MOCK=false
```

执行本地 D1 迁移后启动开发服务器：
```bash
pnpm --filter @mindmap/web run db:local
pnpm dev
```

### 2.2 生产环境（Cloudflare Workers Secrets & Vars）

1. **写入敏感 Secret（绝不提交到代码库）**：
   ```bash
   cd apps/web
   npx wrangler secret put PRO_LLM_BASE_URL
   npx wrangler secret put PRO_LLM_API_KEY
   ```
2. **确认非敏感 Vars（`apps/web/wrangler.jsonc` 或 Cloudflare Dashboard）**：
   - 更换 `AI_FREE_MODEL` 前，在 `apps/web` 下用 `pnpm exec wrangler ai models list --search <模型名> --task "Text Generation"` 核对完整 ID，并用新模型实际完成一次节点扩展。`/api/ai/config` 的 `isMock: false` 只表示有 AI 绑定，不代表模型可以调用；
   - 将 `PRO_LLM_MODEL` 更新为你代理站支持的强力模型名称；
   - 确认 `AI_ALLOW_MOCK` 保持 `"false"`；
   - 确认 `wrangler.jsonc` 中 `"ai": { "binding": "AI" }` 已存在。
3. **通过现有受控生产发布工作流发布**：
   - 触发 `.github/workflows/deploy-production.yml`，该工作流会自动对生产 D1 执行待运行的 `0005_ai_usage.sql` 迁移并部署 Worker。

---

## 3. 上线前人工验收清单

- [ ] 打开 `https://loomind.jeremyxie.com/try`（无痕窗口，未登录）：
  - [ ] 确认顶栏与 AI 面板显示「Cloudflare Workers AI 免费体验」，**不再出现 Mock 徽标**；
  - [ ] 输入主题生成思维导图，确认节点实时逐枝流式生长；
  - [ ] 连续调用超过 `AI_FREE_DAILY_LIMIT` 后收到清晰的 429 额度用尽与登录引导提示。
- [ ] 使用 Google 账号登录进入 `/app` 与编辑器：
  - [ ] 确认 AI 面板显示「Pro 付费模型」及配置的 `PRO_LLM_MODEL`，**不再出现 Mock 徽标**；
  - [ ] 测试整图流式生成、6 项节点快捷操作（扩展 / 拆任务 / 概要 / 聚类 / 长备注 / 智能风格）及「停止生成」按钮；
  - [ ] 测试生成后按 `Ctrl+Z` 一键撤销，并确认云端 D1 同步成功无 422 / 413 报错；
  - [ ] 在 `/app/new` 的 Idea 模式创建并触发 Pro LLM 自动生成。
