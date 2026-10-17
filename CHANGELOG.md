# Changelog

This template uses date-based release tags instead of package SemVer.

Tag format:

- `vYYYY.MM.DD`
- `vYYYY.MM.DD.N` for multiple releases on the same day

## Unreleased

- Add official Monad and MON artwork to the landing page, align its primary color and responsive hero layout, and document brand asset sources.

- Combine connector setup into one copy action using a five-minute, single-use launch code. The CLI exchanges it for a resource credential and only prompts locally for the upstream key; no long-lived key is included in command arguments.

- 买方可申请退回未使用的 MON：申请留痕、停止接单、保留不确定预留、展示处理状态，并通过钱包提取已释放退款。

- Package the local connector as a standalone Node.js CLI with a platform-hosted npm archive, copyable npx commands and isolated installation/streaming tests. Merchants can run from any directory without the project source, pnpm or database setup; retain an npm publishing path.

- 新部署改用原生 MON：测试网/本地链托管、按量分账、退款与提现，链上 wei 与整数 microMON 账本精确转换；钱包无需 ERC20 授权。
- 预算首次确认后原子创建会话密钥，返回 Base URL、Key 和模型名；重复确认不重复发 Key，前端支持逐项或整组复制。
- 旧 dUSD 配置与账本保持原单位，仅服务已有会话；原生 MON 部署须使用隔离数据库及数据目录。

- Run production Web servers from independent build copies so later builds and verification cannot remove live CSS, JavaScript or server files.

- Discover models from OpenAI-compatible gateways, including Magpie. Create unpublished local connection drafts before choosing a discovered model and prices; keep existing resource and lease models immutable. Add model discovery to direct gateway onboarding without exposing local upstream keys.

- Improve landing-page code readability and copy feedback, scroll-aware navigation, FAQ focus, and mobile menu dismissal with focus restoration.

- Add an explicit development-only console preview so frontend review does not require database or chain services; keep backend actions blocked.

- Add a merchant local connector with a persistent outbound CLI, resource-scoped hashed credentials, a Postgres job queue, streaming delivery and prepaid metering. Keep upstream keys on the merchant machine; stop admission after heartbeat expiry and retain reservations for uncertain claimed work.

- Default contracts, wallet network metadata and Web/worker startup to Monad testnet (10143); isolate its runtime directory, disable demo identities by default, and retain the configured network during RPC failures. Require explicit local mode for isolated EVM tests.

- Add wallet-authenticated versioned REST APIs for merchant resource management, consumer budget sessions, API keys, request ledgers and settlements; add key-scoped usage lookup, strict OpenAPI contracts, local HTTP smoke coverage, and Chinese merchant/consumer integration guides.

- Remove decorative homepage microcopy and rounded logo tiles, keeping the transparent connector mark.
- Refine the mon2api connector icon with symmetric, stroke-free ribbons; synchronize the homepage, console, hero artwork and SVG/ICO favicons.
- Add a Monad-inspired public homepage with an animated mon2api ribbon mark, responsive navigation, resource and settlement explanations, copyable TypeScript/Python SDK examples, FAQs and reduced-motion support; preserve the existing wallet-enabled console at `/console`.

- Simplify overview helper text, duplicate network status and empty-state captions; move metric scope to a tooltip and screen-reader text, and show metric breakdowns only when nonzero.

- Add distinct API and OAuth-pool resource onboarding, persist connection modes with an API-compatible default, expose mode filters through REST/OpenAPI, and keep OAuth authorization and account scheduling on the provider's pool gateway.
- Remove demo sign-in and simulated resource creation from the user console; show gateway resources and their related records, with empty states when none exist. Retain database demo records for local tests.

- Replace native budget-session dropdowns with styled, keyboard-accessible selectors, with option descriptions, selected indicators, and dialog-aware menus.
- Align console and wallet styling with Monad's violet, lavender and near-black palette; add monospaced controls, a restrained dot texture and a rounded mon2api connector mark with matching browser icons.
- Remove repeated console headings, workspace placeholders, promotional copy and implementation notes; keep concise pricing, data scope and action-specific guidance.
- Add a custom two-ribbon mon2api mark and matching SVG/ICO browser icons; simplify overview flow decoration and improve explanatory text and charge detail readability after visual review.
- Refine console contrast with a light overview and compact settlement flow; improve resource price hierarchy, searchable result counts, keyboard focus, and mobile touch targets.
- Guide first-time use from resource pricing and budget creation to calling and billing; align market actions, clarify the budget price snapshot, expose billing shortcuts, and improve narrow-screen tables and metrics.
- Bind escrow session IDs to the consumer wallet, preventing another wallet from occupying a pending ID; generate matching random IDs for new leases and cover the attack on a local EVM.
- Document the AI and Web3 native product roadmap for model pricing, Magpie/CC Switch, Monad payments, CLI and MCP, with current capability boundaries.
- Refresh the mon2api console with a mineral palette, a resource-to-settlement flow, clearer prices and states, accessible activity data, and responsive navigation. Label provider-listed prices and declared model IDs; show demo resources and the absence of comparable official prices without implying a discount. Keep desktop cards spacious and let users expand recent billing and API key records on demand.
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
- Add mon2api resource marketplace, consumer/provider console and standard gateway connector.
- Add PostgreSQL metering ledger, atomic reservations, session API keys and idempotent settlement outbox.
- Add OpenZeppelin budget escrow, test dUSD, local EVM and Monad testnet deployment scripts.
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
