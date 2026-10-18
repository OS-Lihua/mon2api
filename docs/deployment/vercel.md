# Token2API 部署

先按[多链结算](../MULTICHAIN.md)配置目标链、资产、独立数据库和运行目录。`pnpm deploy:evm` 部署原生资产或 ERC20 托管合约，并从目标代币合约读取精度。

运行服务设置 `MON2API_MODE=evm`、`ALLOW_DEMO=false`、`DATABASE_URL`、`MON2API_DATA_DIR`、`APP_ORIGIN`、`SESSION_PASSWORD`、`METER_PRIVATE_KEY` 与上游允许来源。应用和 worker 必须读取相同公开链配置。外部资金交易等待 6 个区块确认；确认数不代表所有链均具有相同终局保证，实际环境需逐链验收。

## Web和worker

```bash
pnpm install --frozen-lockfile
pnpm db:migrate
pnpm build
pnpm start
# 独立常驻进程，相同环境与数据库
pnpm worker
```

生产迁移与构建分开。worker每10秒结算，需进程管理、重启和监控。调用45秒、退出窗口120秒；长期网络故障仍可能造成费用无法追回。

`pnpm start` 将完整 standalone 构建、`.next/static` 与 `public` 复制到独立的 `.runtime/web/release-*` 目录后启动。后续 `pnpm build` 或 `pnpm verify` 不会覆盖运行中的文件；发布新构建后需重启 Web 服务才能生效。启动时应等待构建完成。服务退出时自动删除对应副本；异常强制终止遗留的目录可在确认进程已停止后删除。不要直接从会被后续构建覆盖的 `.next/standalone/server.js` 启动共享站点。

浏览器钱包默认通过 EIP-6963 发现，不需要外部服务账号。手机扫码需要在 **构建前** 设置 `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`，并在 WalletConnect Dashboard 配置实际站点 origin；修改后重新构建。仅这个公开应用 ID 使用 `NEXT_PUBLIC_`，绝不传入钱包私钥。本地回环 RPC 不能供手机访问。站点仅在配置 ID 后为 WalletConnect relay/verify 和 MetaMask SDK 增加对应 CSP 连接来源。扫码尚需真实 ID 和移动钱包验收。

Vercel可以承载Web，不能承载本常驻worker。需要独立worker、数据库和RPC。临时或只读文件系统用服务端 `CHAIN_CONFIG_JSON` 保存部署脚本输出的完整公开配置，替代读取chain.json。不要给配置或私钥加NEXT_PUBLIC_前缀。

单机入口限流使用内存。多Web实例需要模板支持的共享Redis限流，只信任部署平台覆盖的IP头。已验证的 API Key、连接器凭证和已登录钱包按凭证单独计数（`RATE_LIMIT_CREDENTIAL_REQUESTS`，默认每窗口 600 次），不再与同一代理后的其他客户端共用 IP 配额；匿名请求与认证失败仍按 IP 计数。高并发时在 `DATABASE_URL` 设置 `connection_limit` 与 `pool_timeout`，所有进程的连接总数应低于数据库 `max_connections`。数据库和签名发送已有跨进程锁，多实例故障切换仍需压力与故障注入验收。

## Docker

`docker-compose.yml`只启动本地数据库。`docker-compose.app.yml`用于 EVM 常驻部署，包含迁移、Web和worker。需配置 `POSTGRES_PASSWORD`、`SESSION_PASSWORD`、`METER_PRIVATE_KEY`、`CHAIN_CONFIG_JSON` 与 `APP_ORIGIN`；可选钱包 Project ID 通过同名 build arg 注入。容器镜像和目标主机部署尚未验收。

## 发布验收

先运行 `pnpm verify`；本地 `pnpm test:e2e` 必须在显式设置 `MON2API_MODE=local`、`ALLOW_DEMO=true` 的隔离数据库与数据目录中运行。再在目标环境以两个真实钱包验证登录、授权、锁预算、真实网关调用、计费、分账、退款和提现。模拟响应和演示身份不能替代真实钱包与上游验收。当前代码支持目标链部署，但本次改动不自动发布或发送真实资金交易。
