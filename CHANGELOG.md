# Changelog

This template uses date-based release tags instead of package SemVer.

Tag format:

- `vYYYY.MM.DD`
- `vYYYY.MM.DD.N` for multiple releases on the same day

## Unreleased

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
