# Changelog

This template uses date-based release tags instead of package SemVer.

Tag format:

- `vYYYY.MM.DD`
- `vYYYY.MM.DD.N` for multiple releases on the same day

## Unreleased

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

- Add distinct API and OAuth-pool resource onboarding, persist connection modes with an API-compatible default, expose mode filters through REST/OpenAPI, and keep OAuth authorization and account scheduling on the provider's pool gateway.
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
