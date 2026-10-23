# Changelog

This template uses date-based release tags instead of package SemVer.

Tag format:

- `vYYYY.MM.DD`
- `vYYYY.MM.DD.N` for multiple releases on the same day

## Unreleased

- 控制台的键盘跳转链接改用 Next.js 路由并将焦点移到正文标题，修复跳到主要内容后跨页返回时地址与页面内容不同步的问题。

- 生产构建前显式生成 Prisma 客户端，避免 Vercel 恢复依赖缓存后使用旧数据模型；数据库迁移仍由独立工作流执行。

- 修复 Next.js 包装的 POST Request 在 Node.js 24 上重建时触发私有字段错误的问题，保留请求头、取消信号、160 KiB 请求体限制和读取超时，恢复 tRPC 钱包登录与表单提交。

- 修复 Node.js 24 上网关代理的 fetch 与 Undici dispatcher 版本不匹配，统一代理传输实现并保留原生 Request、响应状态与流式响应；与 Vercel 使用相同 Node 主版本进行 CI 校验。

- 启用 GitHub Actions 校验与 Vercel 自动发布：推送 main 后先运行隔离数据库、本地 EVM、pnpm verify 和 HTTP 恢复测试，成功后由 Vercel 使用 production 敏感变量构建和发布。生产数据库迁移保留为独立手动工作流，凭证使用分离的 GitHub Environments；关闭 Vercel 重复 Git 自动部署。

- 结算配置缺失时继续隐藏历史金额和报价弹窗，防止默认资产误标旧账；区分预付退款去向，阻止为内部预付预留创建旧式会话 Key。

- 新增模型 Key 与平台路由：用户创建 Key 并授权 1–100 个模型，所有 Key 共用钱包的预付余额；管理员配置统一模型报价、上游映射和路由优先级。模型市场、密钥页、调用实验室、首页和账单同步调整，不再要求调用者选择供应商。
- 新版托管合约支持钱包签名充值、可用余额提取、逐次预留与供应商分账。每次调用固定提供者、资源与双报价快照；Key 级幂等阻止跨路由重放。持久化交易恢复不重放推理，REVIEW 保留预留。原有会话、密钥和资金规则保持兼容；启用新合约须使用独立账本，不转换旧余额。
- 复用公共模型选择器与预付账户面板，补齐模型搜索、权限编辑、报价和路由表单；修复公共弹窗 Tab 焦点循环，明确预付退款与原会话退款的不同去向。

- 控制台改用 Next.js 文件路由：资源市场、我的资源、调用实验室、账单与 API 密钥有独立地址和页面标题，支持直达、刷新、新标签页及浏览器前进后退。共享布局保留钱包、调用草稿和操作状态，导航后管理标题焦点与手机菜单；已知分区 hash 链接自动转到新地址。

- 重整 Token2API 前端为 SaaS 数据工作台：统一蓝色主操作、灰白内容区、深蓝导航与语义状态色；复用搜索、筛选、分页、弹窗和金额格式化。资源市场增加表格/卡片比较、状态/接入类型筛选与价格排序；账单、密钥及商家资源增加查询和分页，显示资金预留与统计范围。后台增加审核弹窗、停用影响确认、查询重试及关联资源前后翻页。首页增加按角色进入工作区的入口；调用实验室明确整段响应状态、快捷键发送和失败核账路径。完善移动端导航、焦点恢复、输入校验和重复提交保护；未知用量不显示零费用或已结算。

- 修复 Vercel 函数启动时缺少 Next.js framework 模块的问题，将运行时所需文件加入部署追踪，避免控制台数据接口在启动前返回 500。

- 补充 Vercel 发布流程和生产配置要求，使用 `.vercelignore` 排除环境变量、本地运行状态、审计缓存和构建输出，避免 CLI 上传本机敏感文件。

- 修复代理认证与流量限制：带认证的远程代理强制 HTTPS，并在运行时拦截已有不安全配置；推理响应在 SDK 解析前限制为 2 MiB，累计文本限制为 64 KiB，超限中止并保留 REVIEW 预算。tRPC 与 REST 共用 160 KiB 请求体上限及 10 秒读取期限，tRPC 每批最多 10 个操作。升级受影响的 tmp、Vite 开发依赖。

- 独立安装包升级为 0.2.0，新增面向人和 AI 的 `token2api` 商家 CLI：钱包签名登录、模型发现、资源接入/查询/报价修改/上下架、本机凭证配置及接单；默认 JSON、命令 Schema、分页、预演和稳定退出码。隐私输入要求用户在真实终端手动完成，禁止命令行私钥；钱包及本机凭证支持本地加密保存，写入结果未知时不自动重试。

- 新增 `/admin` 接入管理后台，按当前托管合约管理员钱包鉴权，管理网关和代理地址白名单、查看关联资源；停用地址停止新接单，不影响已有结算和资金退出。白名单改为数据库管理，升级后需审核并重新上架现有直连资源。
- 平台直连网关支持可选 HTTP/HTTPS 代理及加密代理认证。模型发现和流式调用使用同一代理，默认直连；不跟随重定向，不在代理失败后切换直连或重发推理请求。

- Default new deployment examples and the unconfigured console to Base with Circle-issued USDC; keep USDT and other explicitly configured settlement assets available. Remove the 1–100 budget cap and the prefilled amount, accept positive exact micro-unit budgets, and widen ledger amount columns to BIGINT without changing existing units or values. Keep numeric REST amounts within the exact JSON safe-integer range.

- Discard late budget-confirmation credentials after a wallet identity change. Persist signed escrow transactions and nonce assignments before broadcast, wait for confirmations outside the signer lock, replay saved transactions after failures, and process up to four settlement sessions concurrently.

- Remove legacy settlement-asset fallbacks, dUSD runtime support and older escrow reuse paths. Require explicit asset metadata, move the faucet token into test fixtures, and use only t2a_, t2c_ and t2l_ credentials. Publish connector 0.1.5; existing credentials must be regenerated. Add a database migration for the signed transaction outbox without converting existing balances.

- Use one escrow owner wallet for deployment, metering, administration and future platform fees. Add two-step ownership handover and pause/resume to both escrows, preserve consumer timeout exits and withdrawals while paused, and reject stale worker signers against the live on-chain owner. Replace separate signing/treasury settings with ESCROW_OWNER_PRIVATE_KEY and add escrow:admin commands; new contracts require an isolated ledger.

- Let native-asset escrow users withdraw their own credit to a chosen recipient, including contract wallets that reject plain native transfers. Add a recipient field to web withdrawals and cover rejected transfers, caller ownership, retries and reentry on a local EVM.

- Accept custom gateway API base paths consistently for model discovery and streamed inference in direct and local-connector modes. Keep origin approval and credential protections; publish connector 0.1.4.

- Remove OAuth-pool onboarding and connection-mode fields from the UI, database, REST and OpenAPI. All resources use gateway URLs and inference API keys; user login remains wallet-signature based.

- Remove obsolete naming aliases and configuration fallbacks. Release connector 0.1.3 so cached packages do not retain the removed command alias. Only TOKEN2API_* settings, the token2api wallet cookie/router/response field and token2api-connector command remain. Normalize database, Docker project, seed, signer-lock and migration names; existing migration records are not translated.

- Standardize Token2API branding, token2api source filenames and internal API calls, Token2Api code identifiers and TOKEN2API_* environment variables.

- Split the console into focused sections, dialogs, shared UI and wallet transaction helpers; load secondary sections and dialogs on demand and warm their chunks after the initial render.

- Harden the backend for high concurrency: rate-limit verified API keys, connectors and signed-in wallets per credential (`RATE_LIMIT_CREDENTIAL_REQUESTS`) while failed credentials still spend the per-IP quota; cache the parsed chain config, the deployment binding check and the RPC client; share admission chain reads per session; wake local-connector waiters in process instead of polling every 250 ms; cache the dashboard RPC health check; add indexes for per-listing admission counts, provider dashboards and key revocation.

- Remove dead code: the unmounted template post example (router, service, schema, tests, Prisma `Post` model and its table via migration), the unused server analytics helper and `posthog-node`, the unused RSC tRPC caller and router inference types, the `parseMicroDUSD` and `keyCreatedResponse` aliases, the unused legacy brand SVG, unused global CSS rules, and exports only used inside their own module.

- Add brand icons: SVG marks for every settlement chain, USDT, USDC and native-coin asset icons, an Apple touch icon, a web app manifest with 192/512 and maskable icons, and an Open Graph share image. Metadata URLs resolve from `APP_ORIGIN`.

- Unify all console sections with the multichain landing page: shared chain glyphs, a current-market context bar, supported-network directory, dark overview flow, separate metric cards, refined resource pricing, tables, forms and dialogs. Expand development-only preview data for UI review; preview backend operations remain blocked.

- Refine the multichain UI with a dark network diagram, chain glyphs, clearer card hierarchy, consistent green actions and responsive spacing. Align console surfaces and the unconfigured-market empty state with the landing page.

- Present all supported EVM networks equally across the landing page, FAQ and documentation, with native assets and explicitly configured USDT/USDC. Use Ethereum mainnet (chain ID 1) with ETH for the default configuration example.

- Replace the former violet and orbital visual treatment with a neutral multichain UI: teal actions, navy/slate surfaces, chain-colored nodes and a shared settlement hub. Synchronize console, wallet dialogs, SVG marks and ICO favicon. Hide quotes and ledger views when no supported settlement deployment is configured, so historical amounts cannot be shown with a fallback asset label.

- Align landing-page capabilities, network/native-token directory, usage steps, FAQs and metadata with multichain settlement; distinguish supported networks from assets opened in the current market.
- Show the current network, settlement asset and gas currency in the console and budget confirmation; explain stablecoin authorization and same-asset refunds, and add browser usage guides.

- Replace chain-specific branding and configuration with Ethereum, Base, Arbitrum, Optimism, BNB Smart Chain (BSC), Polygon, Avalanche and Robinhood Chain deployment support.
- Support each chain's native asset and explicitly configured USDT/USDC contracts, including 6–18 decimal tokens, ERC20 approval and exact micro-unit conversion.
- Bind each isolated ledger to its chain, asset, token precision and escrow; preserve migration history and historical denominations. A running instance still serves one chain and asset.
- Add `deploy:evm`, refresh REST/OpenAPI units and document stablecoin provenance and per-chain acceptance requirements.

- Rename the product to Token2API and the repository/package identifiers to token2api. Update page metadata, wallet sign-in text, OpenAPI titles, artwork labels, SDK examples and docs. Package the platform-hosted connector as `@token2api/connector` 0.1.2 with the `token2api-connector` command.



- Combine connector setup into one copy action using a five-minute, single-use launch code. The CLI exchanges it for a resource credential and only prompts locally for the upstream key; no long-lived key is included in command arguments.


- Package the local connector as a standalone Node.js CLI with a platform-hosted npm archive, copyable npx commands and isolated installation/streaming tests. Merchants can run from any directory without the project source, pnpm or database setup; retain an npm publishing path.

- 预算首次确认后原子创建会话密钥，返回 Base URL、Key 和模型名；重复确认不重复发 Key，前端支持逐项或整组复制。

- Run production Web servers from independent build copies so later builds and verification cannot remove live CSS, JavaScript or server files.

- Discover models from OpenAI-compatible gateways, including Magpie. Create unpublished local connection drafts before choosing a discovered model and prices; keep existing resource and lease models immutable. Add model discovery to direct gateway onboarding without exposing local upstream keys.

- Improve landing-page code readability and copy feedback, scroll-aware navigation, FAQ focus, and mobile menu dismissal with focus restoration.

- Add an explicit development-only console preview so frontend review does not require database or chain services; keep backend actions blocked.

- Add a merchant local connector with a persistent outbound CLI, resource-scoped hashed credentials, a Postgres job queue, streaming delivery and prepaid metering. Keep upstream keys on the merchant machine; stop admission after heartbeat expiry and retain reservations for uncertain claimed work.


- Add wallet-authenticated versioned REST APIs for merchant resource management, consumer budget sessions, API keys, request ledgers and settlements; add key-scoped usage lookup, strict OpenAPI contracts, local HTTP smoke coverage, and Chinese merchant/consumer integration guides.

- Remove decorative homepage microcopy and rounded logo tiles, keeping the transparent connector mark.
- Refine the Token2API connector icon with symmetric, stroke-free ribbons; synchronize the homepage, console, hero artwork and SVG/ICO favicons.

- Simplify overview helper text, duplicate network status and empty-state captions; move metric scope to a tooltip and screen-reader text, and show metric breakdowns only when nonzero.

- Remove demo sign-in and simulated resource creation from the user console; show gateway resources and their related records, with empty states when none exist. Retain database demo records for local tests.

- Replace native budget-session dropdowns with styled, keyboard-accessible selectors, with option descriptions, selected indicators, and dialog-aware menus.
- Remove repeated console headings, workspace placeholders, promotional copy and implementation notes; keep concise pricing, data scope and action-specific guidance.
- Add a custom two-ribbon Token2API mark and matching SVG/ICO browser icons; simplify overview flow decoration and improve explanatory text and charge detail readability after visual review.
- Refine console contrast with a light overview and compact settlement flow; improve resource price hierarchy, searchable result counts, keyboard focus, and mobile touch targets.
- Guide first-time use from resource pricing and budget creation to calling and billing; align market actions, clarify the budget price snapshot, expose billing shortcuts, and improve narrow-screen tables and metrics.
- Bind escrow session IDs to the consumer wallet, preventing another wallet from occupying a pending ID; generate matching random IDs for new leases and cover the attack on a local EVM.
- Refresh the Token2API console with a mineral palette, a resource-to-settlement flow, clearer prices and states, accessible activity data, and responsive navigation. Label provider-listed prices and declared model IDs; show demo resources and the absence of comparable official prices without implying a discount. Keep desktop cards spacious and let users expand recent billing and API key records on demand.
- Accept verified escrow opening events routed through contract wallets; bound worker scans and add an indexed active-lease audit.
- Retain late upstream usage evidence when the worker moves an interrupted request to review; keep its reservation until manual resolution.
- Preserve exact micro dUSD amounts in budget and price inputs; show small charges and large chain balances without floating-point rounding, and mark unavailable RPC balances clearly.
- Document a working official OpenAI SDK example with per-request idempotency keys and guidance for lost responses.
- Add a five-minute local product demo guide and make end-to-end settlement verification tolerate automatic worker batches.
- Verify lease opening events and chain confirmations before activation, including hash-free recovery and current close state.
- Continue collecting upstream usage after a REST stream disconnect; show unknown usage as pending review instead of zero.
- Restrict demo identities to the configured loopback chain and resume interrupted session closures in the settlement worker.
- Generate an OpenAPI streaming schema that accepts interim null finish reasons; require stable chat idempotency keys and add database constraints for prepaid lease balances.

- Replace the single injected wallet button with RainbowKit/wagmi wallet selection, Chinese sign-in guidance, account/network menus and optional WalletConnect support; clear stale wallet sessions on account changes.
- Refresh the console with a graphite sidebar, purple actions and more readable content.
- Add Token2API resource marketplace, consumer/provider console and standard gateway connector.
- Add PostgreSQL metering ledger, atomic reservations, session API keys and idempotent settlement outbox.
- Add wallet signature sessions, encrypted connector credentials, background settlement and review resolution.
- Add local end-to-end smoke coverage and deployment/task documentation.


- Use the standard Prisma 6 client package entry point so Next.js externalizes its runtime, avoiding Turbopack dynamic filesystem tracing warnings.

- Enable the React Compiler and Turbopack Rust React Compiler in Next.js.

- Add React Doctor as a project dev dependency with an optional local `pnpm react-doctor` diagnostic command.

- Update compatible dependency releases, including Next.js 15.5.25, and patch vulnerable PostCSS/deepmerge-ts transitive dependencies with scoped overrides.
- Fix Docker package-manager installation, Prisma generation, executable Compose helper, and hook setup without Git; add a separate migration image/service before Compose app startup.
- Commit the initial Postgres migration, document existing-database baselining, and preserve the ID sequence when seeding.
- Apply shared rate limiting to every tRPC procedure invocation, including batches, require explicit trust of one sanitized proxy IP header, and fail closed on Redis errors/timeouts.
- Bound in-memory rate-limit storage, reclaim expired entries, and reject new identities at capacity without evicting active quotas.
- Validate migrations, dependency security, seeded API writes, and clean Docker deployments in CI; keep optional integrations credential-free by default.

- Add REST endpoint helpers for consistent rate limiting, validation, CORS, and structured errors.
- Tune Dependabot to only open npm version-update PRs for major dependency upgrades.
- Initial production-oriented T3 web API template.
