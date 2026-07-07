# 小程序雷达实施追踪表

本文档用于持续追踪“小程序雷达”的实施进度、问题、风险和验证证据。每次推进代码、文档、部署或外部服务配置后，都应更新对应条目，避免只依赖聊天记录判断项目状态。

更新时间：2026-07-07

## 1. 当前结论

当前仓库已经具备可访问的 Production 静态 MVP：Next.js 产品页面、资源 API、规则型 AI 兜底、Doctor、Weekly、Admin、Cron 入口、Drizzle schema、Vercel 配置和验证脚本均已落地。本地校验、生产构建、Vercel Preview 验证、PR 检查和 Vercel Production 别名验证已通过。

尚未完成的关键事项是外部生产依赖收口：需要配置线上 Postgres、GitHub Token，并在用户确认后再配置可选 OpenAI Key。Cron Secret、Admin Token、Vercel Blob 和 Upstash Redis 资源已在 Production 侧配置；Upstash 通过 Vercel Marketplace 注入 `KV_*` 环境变量，本分支已补齐代码兼容，合并部署后需要复验 Production health。

## 2. 进度总览

| 阶段 | 状态 | 当前证据 | 下一步 |
| --- | --- | --- | --- |
| P0 文档收敛 | 已完成 | 核心文档入口已收敛到产品方案、实施总方案、Vercel 生产方案和本追踪表；重复方案文档已删除；`npm run generate:check`、`npm run mvp-check:test` 和 `npm run deploy:check` 通过 | 后续只维护四份核心文档 |
| P1 本地 MVP | 已完成 | `npm run check`、`npm run build` 通过 | 保持每次关键变更后复跑 |
| P2 Vercel Preview 部署 | 已完成 | PR #360 已合并；Preview URL `https://wechat-miniapp-radar-git-feature-wechat-miniapp-radar-justjavac.vercel.app` 曾通过 `npm run deployment:verify -- <preview-url>`、`npm run mvp:check -- <preview-url>`；GitHub `links`、`validate`、Vercel 检查通过 | 后续功能继续走非 `main` 分支和 Preview 验证 |
| P2.1 Vercel Production 部署 | 已完成 | PR #360 和 PR #361 已合并到 `main`；Production 部署 Ready；生产别名 `https://wechat-miniapp-radar.vercel.app` 通过 `npm run deployment:verify -- <production-url>` 和 `npm run mvp:check -- <production-url>`；`Verify Vercel Production` 已恢复成功 | 继续 P3 外部依赖 |
| P3 Postgres 主库 | 未开始 | `DATABASE_URL` 未配置 | 选择 Neon 或 Supabase，执行迁移和导入 |
| P4 采集与评分 Cron | 进行中 | Cron 代码和鉴权测试已具备；Production 已配置 `CRON_SECRET`，`/api/cron/enrich` 和 `/api/cron/weekly` dry-run 通过 | 配置 `GITHUB_TOKEN`，再做采集额度和真实调度观察 |
| P5 Redis 缓存/限流/任务锁 | 进行中 | Upstash Redis resource `store_YahoH3IFK7st04eQ` 已连接 Production；本分支已兼容 `KV_REST_API_URL`/`KV_REST_API_TOKEN` 并通过本地测试 | PR 合并部署后复验 `/api/health`、部署校验和任务锁 |
| P6 Blob 报告和快照 | 已完成 | Production 已创建 Vercel Blob Store `wechat-miniapp-radar-artifacts` 并配置 `BLOB_READ_WRITE_TOKEN`；Doctor 报告生产上传返回 Blob URL | 后续按免费额度观察 Blob 文件数和存储量 |
| P7 Admin 运维闭环 | 已完成 | Production 已配置 `ADMIN_TOKEN`；`/api/admin/readiness` 授权读取通过；Admin API 和 readiness 已实现 | Postgres 接入后再验证资源维护写入链路 |
| P8 真实 AI | 暂缓 | 规则型 AI 可用，输出校验已覆盖 | 用户确认后再配置 `OPENAI_API_KEY` |
| P9 上线观察 | 未开始 | 尚无生产流量 | 生产部署后观察 7 天 |

状态定义：

- `未开始`：尚未配置或实施。
- `进行中`：已开始但仍有明确未完成项。
- `待生产配置`：代码和本地测试已具备，缺真实外部服务。
- `已完成`：有当前证据证明完成。
- `暂缓`：有意不做，等待明确触发条件。

## 3. 当前问题清单

| ID | 问题 | 影响 | 状态 | 处理方案 |
| --- | --- | --- | --- | --- |
| I-001 | Vercel Production 尚未成功部署 | 无法完成生产验收 | 已关闭 | PR #360 已合并；Production 部署 Ready；`https://wechat-miniapp-radar.vercel.app` 通过部署和 MVP 校验 |
| I-002 | `DATABASE_URL` 未配置 | 线上只能使用静态 JSON 降级 | 打开 | 默认优先 Neon Postgres；需要 Auth 时选 Supabase |
| I-003 | `CRON_SECRET` 未配置 | 生产 Cron 不能授权运行 | 已关闭 | 已在 Vercel Production 配置并 redeploy；Cron enrich/weekly dry-run 通过 |
| I-004 | `ADMIN_TOKEN` 未配置 | Admin readiness 只能验证未授权保护 | 已关闭 | 已在 Vercel Production 配置并 redeploy；Admin readiness 授权读取通过 |
| I-005 | `GITHUB_TOKEN` 未配置 | GitHub 采集额度低 | 打开 | 配置只读 token 或降低采集频率 |
| I-006 | Production 代码尚未识别 Vercel KV Redis 变量 | 生产环境已有 Redis 资源，但当前已部署代码只识别 `UPSTASH_REDIS_*` 旧命名 | 进行中 | 本分支已兼容 `UPSTASH_REDIS_*` 与 `KV_*` 两组 REST 变量；合并部署后关闭 |
| I-007 | Blob 未配置 | 周报、Doctor 报告和导出快照不能归档 | 已关闭 | 已创建 Vercel Blob Store 并连接项目；`/api/doctor` 生产上传报告返回 Blob URL |
| I-008 | 真实 AI 未启用 | Advisor、摘要、周报、Doctor 只能使用规则兜底 | 暂缓 | 用户确认后再配置 `OPENAI_API_KEY` |

## 4. 风险清单

| ID | 风险 | 触发信号 | 应对 |
| --- | --- | --- | --- |
| R-001 | 免费额度不够 | Functions、Redis 命令数、Blob 操作数或数据库容量接近上限 | 限流、缓存、日志保留期、Blob 存大文本 |
| R-002 | AI 编造结论 | 输出引用不存在资源或 URL | 证据校验失败不持久化，回退规则结果 |
| R-003 | Cron 超时或重叠 | 采集任务失败、409 锁冲突频繁 | 分批采集、任务锁、降低频率 |
| R-004 | 密钥泄漏 | public、客户端 bundle 或日志出现 secret 名称和值 | 只在服务端读取，跑 `secret-exposure:test` |
| R-005 | 文档再次分叉 | 多份方案给出不同执行顺序 | 只维护四份核心文档，变更后更新索引 |

## 5. 验证记录

| 日期 | 范围 | 命令/证据 | 结果 | 备注 |
| --- | --- | --- | --- | --- |
| 2026-07-07 | 本地完整检查 | `npm run check` | 通过 | 外部服务缺失只产生 warning |
| 2026-07-07 | Next.js 生产构建 | `npm run build` | 通过 | 258 个静态页面生成成功 |
| 2026-07-07 | 文档生成校验 | `npm run generate:check` | 通过 | README 与生成脚本一致 |
| 2026-07-07 | MVP 文档检查 | `npm run mvp-check:test` | 通过 | 实施状态检查已切到实施总方案和追踪表 |
| 2026-07-07 | 文档结构检查 | `npm run deploy:check` | 通过 | 已自动检查核心文档、重复方案文档、索引链接和追踪表结构 |
| 2026-07-07 | Admin 端点目录检查 | `npm run deploy:check` | 通过 | 已自动检查 Admin 页面包含 readiness 和维护 API |
| 2026-07-07 | 实施追踪 CLI | `npm run tracker:test` | 通过 | `miniprogram-radar tracker` 可输出进度、问题、风险和验证记录 |
| 2026-07-07 | Vercel Preview 部署校验 | `npm run deployment:verify -- https://wechat-miniapp-radar-git-feature-wechat-miniapp-radar-justjavac.vercel.app` | 通过 | 27 pass / 7 warn / 0 fail；warning 为生产密钥和外部服务未配置 |
| 2026-07-07 | Vercel Preview MVP 校验 | `npm run mvp:check -- https://wechat-miniapp-radar-git-feature-wechat-miniapp-radar-justjavac.vercel.app` | 通过 | 49 pass / 10 warn / 0 fail；真实 AI 仍暂缓 |
| 2026-07-07 | Vercel Preview 预检 | `npm run vercel:preflight -- https://wechat-miniapp-radar-git-feature-wechat-miniapp-radar-justjavac.vercel.app` | 通过 | 10 pass / 11 warn / 0 fail；warning 不阻断 Preview |
| 2026-07-07 | UI/UX 预上线优化 | `npm run check`、`npm run build`、`npm run deploy:check` | 通过 | 使用 `ui-ux-pro-max` 和 `karpathy-coding-guidelines`；优化快速搜索加载/错误/焦点反馈，内部路由统一使用 `next/link` |
| 2026-07-07 | 交互与性能补强 | `npm run check`、`npm run build`、Playwright 快速流验证 | 通过 | 使用 `ui-ux-pro-max`、`vercel-react-best-practices`、`karpathy-coding-guidelines` 和 `playwright`；补充搜索弹窗焦点陷阱、筛选按钮语义、结果计数播报、表单加载反馈和 Radar 输入 deferred filtering；本地 Vercel Analytics/Speed Insights 404 为预期 |
| 2026-07-07 | 中文导航、主题切换与首页 Hero | `npm run check`、`npm run build`、Playwright 桌面/移动端检查 | 通过 | 导航菜单改为中文，专有名词保留英文；新增明亮/黑暗主题图标切换和首屏 Radar signal 动效；本地 Vercel Analytics/Speed Insights 404 为预期 |
| 2026-07-07 | Vercel 风格与 Hero 遮挡修正 | Edge 桌面/移动/暗色截图验证、`npm run typecheck`、`npm run build`、`npm run deploy:check` | 通过 | `Radar signal` 改为独立摘要区，不再遮挡动画；主题切换保持 header 最右；配色收敛为 Vercel 式黑白灰、细边框和低动效 |
| 2026-07-07 | 生产上线人工门禁 | `npm run production-readiness:test`、`npm run admin-api:test` | 通过 | 生产就绪清单新增 Preview 人工确认项，明确 PR 验证后再标记 ready、合并 main 和等待 Production 部署；该项不作为缺失生产配置阻断自动化检查 |
| 2026-07-07 | PR 检查 | PR #360 `links`、`validate`、Vercel Preview | 通过 | 用户确认后已合并到 `main` |
| 2026-07-07 | Production 部署 | Vercel deployment `https://wechat-miniapp-radar-oly31c8gg-justjavac.vercel.app`，生产别名 `https://wechat-miniapp-radar.vercel.app` | 通过 | 部署状态 Ready；别名已绑定到最新 Production 部署 |
| 2026-07-07 | Production 环境变量 | `npx vercel env ls`、`/api/health` | 通过 | Vercel Production 已配置 `SITE_URL` 和 `NEXT_PUBLIC_SITE_URL`；`/api/health` 显示 `integrations.siteUrl:true` |
| 2026-07-07 | Production 部署校验 | `npm run deployment:verify -- https://wechat-miniapp-radar.vercel.app` | 通过 | 27 pass / 7 warn / 0 fail；warning 为 Postgres、GitHub、Cron Secret、Admin Token、Blob、Redis、OpenAI 未配置 |
| 2026-07-07 | Production MVP 校验 | `npm run mvp:check -- https://wechat-miniapp-radar.vercel.app` | 通过 | 49 pass / 10 warn / 0 fail；warning 为本地/外部生产依赖未配置 |
| 2026-07-07 | GitHub 自动生产验证 | `Verify Vercel Production` run 28856670441 | 失败已修复 | workflow 使用 Vercel 一次性 deployment URL 校验 sitemap/robots canonical，和生产别名 canonical 不一致；PR #361 已调整为优先验证稳定生产域名，并在生产校验时显式传入期望 canonical |
| 2026-07-07 | 部署验证脚本 canonical 处理 | `npm run deployment-verify:test`、`npm run verify-vercel-workflow:test` | 通过 | 部署验证脚本支持访问 URL 和 canonical URL 分离；生产 workflow 使用 `EXPECTED_CANONICAL_URL` 保持严格校验 |
| 2026-07-07 | PR #361 Preview 部署校验 | `npm run deployment:verify -- https://wechat-miniapp-radar-git-chore-fix-production-da3294-justjavac.vercel.app` | 通过 | 26 pass / 8 warn / 0 fail；Preview canonical 指向生产别名，脚本已按 sitemap/robots 一致性处理 |
| 2026-07-07 | PR #361 合并后 Production 部署 | Vercel deployment `https://wechat-miniapp-radar-a1t8ha06d-justjavac.vercel.app`、生产别名 `https://wechat-miniapp-radar.vercel.app` | 通过 | merge commit `8c3851e` 已部署到 Production；`Validate resources` run 28858056384 成功；`Verify Vercel Production` run 28858104678 成功 |
| 2026-07-07 | PR #361 合并后 Production 复验 | `EXPECTED_CANONICAL_URL=https://wechat-miniapp-radar.vercel.app npm run deployment:verify -- https://wechat-miniapp-radar.vercel.app`、`/api/health` | 通过 | 27 pass / 7 warn / 0 fail；`/api/health` 显示 `integrations.siteUrl:true` |
| 2026-07-07 | PR #362 合并后 Production 部署 | Vercel deployment `https://wechat-miniapp-radar-q9ftsi5xa-justjavac.vercel.app`、生产别名 `https://wechat-miniapp-radar.vercel.app` | 通过 | merge commit `2223fdb` 已部署到 Production；`Validate resources` run 28858714019 成功；`Verify Vercel Production` run 28858757802 成功 |
| 2026-07-07 | Cron/Admin 生产密钥配置 | `npx vercel env add CRON_SECRET production`、`npx vercel env add ADMIN_TOKEN production`、Production redeploy | 通过 | 重新构建部署 `https://wechat-miniapp-radar-kxzjbvihv-justjavac.vercel.app` 后，`/api/health` 显示 `cronSecret:true`、`adminToken:true` |
| 2026-07-07 | Cron/Admin 授权生产复验 | `VERIFY_CRON_SECRET=<secret> VERIFY_ADMIN_TOKEN=<secret> EXPECTED_CANONICAL_URL=https://wechat-miniapp-radar.vercel.app npm run deployment:verify -- https://wechat-miniapp-radar.vercel.app` | 通过 | 32 pass / 5 warn / 0 fail；Cron enrich/weekly dry-run 和 Admin readiness 授权读取均通过 |
| 2026-07-07 | Vercel Blob Store 配置 | `npx vercel blob create-store wechat-miniapp-radar-artifacts --access public --environment production --yes`、Production deploy | 通过 | Blob Store `store_3a5qRZebeUOkJe88` 已创建并连接项目；`/api/health` 显示 `blob:true` |
| 2026-07-07 | Vercel Blob 生产写入验证 | `POST /api/doctor` with `uploadReport:true` | 通过 | Doctor 报告上传成功，返回 `*.public.blob.vercel-storage.com` Blob URL；生产部署校验为 30 pass / 4 warn / 0 fail |
| 2026-07-07 | Upstash Redis 生产资源配置 | `npx vercel marketplace add` / Vercel Marketplace Upstash Redis resource | 通过 | Resource `wechat-miniapp-radar-redis` / `store_YahoH3IFK7st04eQ` 已连接 Production；Vercel 注入 `KV_REST_API_URL`、`KV_REST_API_TOKEN` 等变量 |
| 2026-07-07 | Redis 环境变量兼容本地验证 | `npm run check` | 通过 | 兼容 `UPSTASH_REDIS_REST_URL`/`UPSTASH_REDIS_REST_TOKEN` 和 `KV_REST_API_URL`/`KV_REST_API_TOKEN`；覆盖 health、task-lock、cron-routes、mvp-check、production-bootstrap、workflow 检查 |

## 6. 下一步执行清单

### 6.1 文档收敛

- 后续只维护产品方案、实施总方案、Vercel 生产方案和实施追踪表。
- 新增实施问题时优先更新本追踪表。
- 需要查看当前实施状态时执行 `npx miniprogram-radar tracker` 或 `npm run tracker -- --json`。
- 文档入口变化后执行 `npm run generate` 和 `npm run generate:check`。

### 6.2 生产部署

已完成：

```text
https://wechat-miniapp-radar-git-feature-wechat-miniapp-radar-justjavac.vercel.app
https://wechat-miniapp-radar.vercel.app
```

后续每次 Production 变更后执行：

```bash
npm run vercel:preflight -- https://wechat-miniapp-radar.vercel.app
npm run deployment:verify -- https://wechat-miniapp-radar.vercel.app
npm run mvp:check -- https://wechat-miniapp-radar.vercel.app
```

### 6.3 数据与集成

1. 合并 Redis 环境变量兼容分支，等待 Production 部署后复验 `/api/health` 中 `upstashRedis:true`。
2. 创建 Neon 或 Supabase Postgres。
3. 配置 `DATABASE_URL`。
4. 执行：

```bash
npm run db:migrate
npm run db:import
EXPECT_DATABASE=1 npm run db:verify
```

5. 配置 `GITHUB_TOKEN`。
6. 执行：

```bash
EXPECT_GITHUB=1 EXPECT_BLOB=1 EXPECT_UPSTASH_REDIS=1 npm run integrations:verify
VERIFY_CRON_SECRET=<CRON_SECRET> VERIFY_ADMIN_TOKEN=<ADMIN_TOKEN> npm run deployment:verify -- <production-url>
```

## 7. 更新规则

- 每次完成一个阶段，把状态改为 `已完成` 并补充验证证据。
- 每次发现问题，新增到“当前问题清单”，不要只写在聊天记录里。
- 每次解决问题，保留问题记录，把状态改为 `已关闭` 并写明处理方式。
- 每次新增生产依赖，必须补充环境变量、验证命令和降级策略。
- 不把真实 AI 视为默认完成项；只有用户确认并完成线上验证后才标记完成。
