# Loomind 生产发布

目标是现有 Cloudflare 账号中的 `loomind` Worker、`DB` 绑定的 D1 数据库和 [loomind.jeremyxie.com](https://loomind.jeremyxie.com/)。`apps/web/wrangler.jsonc` 是 Worker 名称、账号、D1 ID、域名及公开变量的来源。发布命令使用仓库锁定的 Wrangler 4.164.0。

## GitHub 仓库管理员一次性配置

1. 在 **Settings → Environments** 创建 `production`，设置 required reviewers，并将 deployment branches 限制为 `main`。审批人应检查 E2E 记录和待部署的完整提交 SHA；不要开启绕过审批的发布路径。
2. 在 **Settings → Secrets and variables → Actions → Variables** 设置以下仓库变量。变量是目标标识，不是密钥：

   | 变量 | 值 |
   | --- | --- |
   | `CLOUDFLARE_ACCOUNT_ID` | `9198bde6a94accd267e7ead951ed037e` |
   | `CLOUDFLARE_WORKER_NAME` | `loomind` |
   | `CLOUDFLARE_D1_DATABASE_ID` | `20f4062e-5a50-46f1-b74b-c48acc0e1ad4` |
   | `LOOMIND_PRODUCTION_URL` | `https://loomind.jeremyxie.com` |

3. 在 **production 环境的 Secrets** 设置 `CLOUDFLARE_API_TOKEN`。令牌必须属于上表账号，并允许读取现有 Worker deployment 和 secret 名称、读取 D1 Time Travel、应用 D1 迁移，以及部署 Worker 和现有自定义域名。按 Cloudflare 最小权限原则配置；不要把令牌放入仓库变量、`wrangler.jsonc` 或命令参数。
4. 保持现有 Worker 的 `GOOGLE_CLIENT_ID`、`TURNSTILE_SECRET`、`SESSION_SECRET` 为 Cloudflare Worker secrets。工作流只核对名称和存在性，不读取或重写值。`AUTH_ORIGIN` 和 `TURNSTILE_SITE_KEY` 由受版本控制的 Wrangler 配置提供。
5. 为 `main` 设置分支保护，要求 GitHub Actions 的 **CI / Verify** 检查成功，并禁止跳过必要审查。PR 和每次 `main` push 都会执行冻结安装、类型检查、测试和构建。

如果 GitHub 仓库计划不支持环境 required reviewers，先建立等效的人工作业审批控制再启用生产发布。仅创建一个名为 `production` 的环境不会自动产生审批门槛。

## 发布顺序

1. 完成 PR 审查与 CI，合并后等待 `main` 的 CI 通过。按该提交的实际功能完成端到端验收，并保存记录。至少检查首页（`/`）加载与交互预览、登录页（`/login`）Google + Turnstile 登录、工作区（`/app`）创建和切换多张导图、保存后重开、退出登录；合入 AI、大纲或共享功能后，把相应路径加入同一份验收记录。
2. 在 **Actions → Deploy production → Run workflow** 选择 `main`，填写已验收的完整 40 位 SHA 和 E2E 记录链接或编号。工作流拒绝其他分支、SHA 不匹配或空记录；它会为该提交重新运行与 CI 相同的检查。
3. `production` 审批通过后，发布作业再次构建并检查 `main` 仍指向已验收提交。它将仓库变量与 Wrangler 配置逐一核对，执行 `wrangler deploy --dry-run`，远端确认 Worker、所需 secret 名称及 D1 Time Travel 可用。任一检查失败都会在数据变更前停止。
4. 作业把**发布前 Worker 版本 ID**和**迁移前 D1 bookmark**写入本次 Actions 的 Job summary，列出待应用的远端迁移，然后运行 `wrangler d1 migrations apply DB --remote`。Wrangler 在迁移时也会自动捕获备份；工作流随后核对远端 `mindmaps` 表存在。
5. 迁移通过后才运行 `wrangler deploy`。部署成功后自动检查生产首页、构建的 JS 静态资源、游客会话、登录 challenge 与未授权导图访问，并记录新 Worker 版本。绿色工作流表示这些自动检查通过；真实 Google 登录和跨设备导图同步仍须按第 1 步的验收清单在生产域名人工复核。

CD **没有** `push`、`workflow_run` 或 PR 自动发布触发器。审批前不会运行远端迁移或切换生产流量。工作流不会自动恢复 D1 或自动回滚 Worker，因为两者的兼容性需要现场判断。

> **本地脚本边界说明**：`apps/web/package.json` 的 `deploy` 脚本已禁用直接本地 `wrangler deploy`，仅用于消除误操作入口，**不等于撤销已持有者的 Cloudflare 访问权限**。常规发布必须通过 GitHub Actions 的 `Deploy production` 工作流执行；经批准的应急回滚与数据恢复仍按下方「失败与回退」流程在受信任终端操作。

## 失败与回退

从失败的 Actions Job summary 读取发布前 Worker 版本和 D1 bookmark。先确定失败发生在远端迁移前、迁移后还是 Worker 部署后；迁移成功后即使部署失败，数据库也可能已变更，不要盲目重复发布。

- **仅 Worker 版本有问题，且旧版本兼容当前 D1 结构时：**在受信任的终端用目标账号的 API Token 登录，进入 `apps/web`，运行 `pnpm exec wrangler rollback <PREVIOUS_WORKER_VERSION> --name loomind`，然后复核首页、登录及导图读写。Token 通过受保护的环境变量提供，不写在命令行。
- **迁移破坏了数据或旧 Worker 依赖已删除的表时：**先制定 Worker 与 D1 的配套恢复顺序，再由有权限的操作员确认后运行 `pnpm exec wrangler d1 time-travel restore DB --bookmark <D1_BOOKMARK>`。D1 Time Travel 恢复会原地覆盖 bookmark 之后的写入并中断进行中的查询；不要把代码回滚当成数据回滚。当前 Workers Free 计划的 Time Travel 窗口是 7 天，bookmark 必须在有效期内。
- **恢复后：**重新检查生产域名与真实登录、导图保存/重开，并记录新的部署和数据库状态。Cloudflare Worker 回滚的传播和静态资源版本可能短暂不一致。

当前 `0002_mindmaps.sql` 会把旧 `account_drafts` 数据复制到 `mindmaps`，`0003_remove_account_drafts.sql` 会删除旧表。若这两项在某次发布中仍待应用，审批前应特别核对旧 Worker 是否能继续使用迁移后的表结构。

`0009_mindmap_document_blocks.sql` 是增量迁移，不重写既有快照。以实际工作流为准：当前 `deploy-production.yml` 也监听 `main` push，应在合并前确认发布批准、D1 bookmark 和回退版本。发布后验证旧图、超过 1 MiB 的带图导图及其历史版都能跨会话打开。一旦已有分块快照，不要回滚到只认识内联 JSON 的 Worker；优先向前修复，或发布保留分块读取能力的修复版。不要删除分块表或为代码回滚而直接恢复整库。

团队模板迁移 `0013_workspace_templates.sql` 只新增模板快照及图片分块表，不改写已有导图。发布后，使用测试工作空间验证一名编辑者保存模板、另一名成员创建并修改独立副本。回退到支持分块但不支持模板的 Worker 会暂时隐藏模板；不要删除模板表。已有副本是普通工作空间导图。

参考：[D1 迁移](https://developers.cloudflare.com/d1/reference/migrations/)、[D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/)、[Worker 回滚](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/)、[Worker secrets](https://developers.cloudflare.com/workers/configuration/secrets/)。
