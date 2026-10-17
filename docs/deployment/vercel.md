> 新部署使用 `NativeUsageEscrow` 和原生测试网 MON。必须使用新的数据库/schema 和 `MON2API_DATA_DIR`，迁移后绑定 `asset: "MON"`、零地址 `token` 及新 escrow；旧 dUSD 部署保留原配置。`APP_ORIGIN` 须设为公网 HTTPS origin，买方接入配置据此生成。MON 预算锁定不需要 ERC20 approve。账本单位 microMON，原生余额/转账单位 wei。

# mon2api 部署

默认合约网络为 Monad 测试网（chain 10143）。先运行 `pnpm setup` 准备数据库，再配置或复用测试网部署，最后运行 `pnpm dev` 启动 Web 与结算 worker。共享部署采用PostgreSQL、持久RPC和独立常驻结算worker。测试账户与公开mint的代币不能用于真实资金。

## Monad测试网

为测试网使用独立数据库与数据目录。准备测试MON、部署者私钥、meter私钥和平台收款地址，放入服务器环境或未提交的.env，然后运行：

```bash
pnpm deploy:testnet
```

脚本只接受chain10143，拒绝主网。`DEPLOYER_PRIVATE_KEY`、`METER_PRIVATE_KEY`、`TREASURY_ADDRESS`必须显式配置。可选 `TESTNET_TOKEN_ADDRESS` 使用现有6位精度测试代币；否则部署公开mint的DemoUSD。默认保存到 `.runtime/monad-testnet/chain.json`，可用 `MON2API_DATA_DIR` 指定其他目录；chain.json 只包含公开部署信息。`MONAD_RPC_URL` 默认 `https://testnet-rpc.monad.xyz`，可替换为返回 chain 10143 的测试网 RPC。新版合约已在测试网独立完成链上资金验证，公开交易见[演示文档](../PRODUCT_DEMO.md#monad-测试网合约证据)；Web 与 worker 使用相同的测试网配置；浏览器钱包与真实网关的完整流程仍待验收。

运行服务配置 `MON2API_MODE=monad-testnet`、`ALLOW_DEMO=false`、独立 `DATABASE_URL`、`APP_ORIGIN`、至少32字符随机 `SESSION_PASSWORD`、`METER_PRIVATE_KEY`、`UPSTREAM_ALLOWED_ORIGINS` 和 `MON2API_DATA_DIR`。每套部署绑定chain ID、代币与合约地址，不能静默替换。资金确认在测试网等待6个区块。新版托管合约要求会话 ID 的前 20 字节为消费者地址；升级已有部署时必须使用新的合约地址、数据目录和数据库，不要将旧会话绑定到新合约。

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

单机入口限流使用内存。多Web实例需要模板支持的共享Redis限流，只信任部署平台覆盖的IP头。数据库和签名发送已有跨进程锁，多实例故障切换仍需压力与故障注入验收。

## Docker

`docker-compose.yml`只启动本地数据库。`docker-compose.app.yml`用于测试网常驻部署，包含迁移、Web和worker。需配置 `POSTGRES_PASSWORD`、`SESSION_PASSWORD`、`METER_PRIVATE_KEY`、`CHAIN_CONFIG_JSON` 与 `APP_ORIGIN`；可选钱包 Project ID 通过同名 build arg 注入。容器镜像和目标主机部署尚未验收。

## 发布验收

先运行 `pnpm verify`；本地 `pnpm test:e2e` 必须在显式设置 `MON2API_MODE=local`、`ALLOW_DEMO=true` 的隔离数据库与数据目录中运行。再在目标环境以两个真实钱包验证登录、授权、锁预算、真实网关调用、计费、分账、退款和提现。模拟响应和演示身份不能替代真实钱包与上游验收。当前MVP不包含真实资产上线。
