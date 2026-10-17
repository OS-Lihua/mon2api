# 可选GitHub Actions模板

本目录保存校验、镜像构建、代码扫描、数据库迁移和发布的配置模板，当前没有自动启用。项目质量检查通过本地 `pnpm verify` 与Git hooks执行。

需要启用时，由具有workflow权限的仓库维护者审核配置、环境与secrets，再将所需文件放入 `.github/workflows/`。数据库迁移和发布模板需配置对应GitHub Environment，不能直接对生产运行。

CI模板包含本地PostgreSQL、生产构建、模拟EVM调用和故障恢复测试。测试网容器部署需实际目标环境验证。
