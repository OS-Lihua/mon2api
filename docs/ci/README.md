# CI/CD 与可选 GitHub Actions 模板

自动校验和 Vercel 发布已移至 [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml)。Pull Request 运行校验；推送 `main` 或在 `main` 手动运行工作流时，校验成功后发布到 Vercel production。校验使用临时 PostgreSQL 和本地 EVM，不读取生产凭证。`pnpm verify` 按顺序执行格式、lint、类型、测试和生产构建，之后运行 HTTP、钱包登录和账本恢复验收。

正式发布使用 GitHub `production` Environment 中的 `VERCEL_TOKEN`、`VERCEL_ORG_ID` 和 `VERCEL_PROJECT_ID`。所有 Actions 固定到提交 SHA，Vercel CLI 固定版本，Node.js 使用 24。校验未通过时不会发布。`vercel.json` 关闭 Vercel Git 自动部署，避免绕过校验或重复发布。构建读取 Vercel production 配置，`vercel deploy --prebuilt --prod` 上传构建产物。

数据库迁移使用独立的 [`DB Migrate`](../../.github/workflows/db-migrate.yml) 工作流，只允许在 `main` 手动运行并输入 `migrate`。数据库直连地址仅保存在 `production-migrations` Environment 的 `DATABASE_URL` secret。发布与迁移使用同一并发锁；它们不会同时执行。发布工作流只读检查生产迁移状态，存在待执行或失败的迁移时停止发布，不执行生产迁移、重置或 seed。迁移完成后，可重新运行目标 `main` 提交的发布工作流。

配置方法、发布与迁移步骤见[部署说明](../deployment/vercel.md#github-actions-自动发布)。结算 worker 仍需独立部署。

本目录保留 Docker 校验、代码扫描和 GitHub Release 的可选模板。它们没有自动启用；需要时由仓库维护者审核后放入 `.github/workflows/`。
