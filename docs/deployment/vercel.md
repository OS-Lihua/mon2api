# Token2API 部署

先按[多链结算](../MULTICHAIN.md)配置目标链、资产、独立数据库和运行目录。`pnpm deploy:evm` 部署原生资产或 ERC20 托管合约，并从目标代币合约读取精度。

运行服务设置 `TOKEN2API_MODE=evm`、`ALLOW_DEMO=false`、`DATABASE_URL`、`TOKEN2API_DATA_DIR`、`APP_ORIGIN`、`SESSION_PASSWORD`、`ESCROW_OWNER_PRIVATE_KEY` 与上游允许来源。应用和 worker 必须读取相同公开链配置。外部资金交易等待 6 个区块确认；确认数不代表所有链均具有相同终局保证，实际环境需逐链验收。

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

Vercel 可以承载 Web 和 API，并通过 Marketplace 接入 PostgreSQL。Web 函数不运行本项目的常驻 worker；结算 worker 需要独立部署。临时或只读文件系统用服务端 `CHAIN_CONFIG_JSON` 保存部署脚本输出的完整公开配置，替代读取 chain.json。不要给配置或私钥加 `NEXT_PUBLIC_` 前缀。

## 发布到 Vercel

1. 在已登录的 Vercel 团队内创建项目，并使用 `vercel link --project <项目名> --scope <团队>` 关联。选择 Next.js、Node.js 24.x、安装命令 `pnpm install --frozen-lockfile` 和构建命令 `pnpm build`。设置 `ENABLE_EXPERIMENTAL_COREPACK=1`，使用 `package.json` 固定的 pnpm 版本。
2. 在项目的 Environment Variables 中手动配置生产环境。必需项为 `DATABASE_URL`、`TOKEN2API_MODE=evm`、`ALLOW_DEMO=false`、`APP_ORIGIN`、`SESSION_PASSWORD` 和 `CHAIN_CONFIG_JSON`；需要由 Web 发起结算时还须配置 `ESCROW_OWNER_PRIVATE_KEY`。钱包私钥、数据库密码和其他凭证由操作者手动输入，不放入聊天、源码或命令行参数。
3. `CHAIN_CONFIG_JSON` 使用实际部署的公开元数据，包括链、RPC、托管合约、资产、代币精度和部署区块。生产数据库必须可从 Vercel 访问，不能使用本机 PostgreSQL 或本地链。应用与独立 worker 使用相同的数据库、链配置和密钥。
4. 在独立发布环境执行 `pnpm db:migrate`，再运行 `pnpm verify`。不要在 Vercel 构建中执行生产数据库迁移。
5. 先运行 `vercel deploy --dry --json` 检查上传清单，再运行 `vercel deploy --prod`。仓库的 `.vercelignore` 排除 `.env*`、本地运行状态、审计缓存、编辑器配置和构建输出；不要依赖 `.gitignore` 代替上传清单检查。
6. 部署后检查首页、`/console`、`/admin`、连接器下载和 `/api/v1/network`。确认 worker 独立运行，再按下方发布验收流程检查真实业务。

`APP_ORIGIN` 填写实际的 HTTPS 正式域名。多实例生产限流需配置 `UPSTASH_REDIS_REST_URL` 和 `UPSTASH_REDIS_REST_TOKEN`。构建成功或页面可打开，不代表数据库、合约和自动结算已配置完成。

PostgreSQL 可以直接在 Vercel Marketplace 创建并绑定到项目，由集成注入数据库连接变量，无需手动复制数据库密码。使用 Neon 时先执行 `vercel integration add neon --help` 查询当前区域和套餐，再选择与 Web 函数相同的区域，仅连接生产环境，并设置 `--metadata auth=false`，保留项目现有的钱包登录方式。运行服务使用连接池地址，独立迁移进程使用直连地址。

数据库和链上市场分别配置。数据库可用、合约尚未配置时，控制台数据接口应正常返回，界面显示“结算市场待开通”；`/api/v1/network` 返回带 `chain_unavailable` 的 503。不要为了让状态变为就绪而填入测试合约或虚构的链配置。

若云端函数启动日志提示缺少 `next/dist/lib/framework/boundary-constants`，检查 `next.config.js` 的 `outputFileTracingIncludes`。本项目显式包含 Next.js framework 运行文件，以补齐 Vercel 启动器的依赖追踪。

## GitHub Actions 自动发布

仓库启用 `.github/workflows/ci.yml`。Pull Request 自动运行 `Verify`；推送 `main` 后，`Verify` 成功才运行 `Deploy production`。也可在 Actions 页面选择 `CI and Vercel`，在 `main` 手动重试。校验在临时 PostgreSQL 和本地链 31337 上运行迁移、`pnpm verify`、HTTP API、钱包签名与账本恢复测试，不使用生产数据库或真实资金。

首次配置：

1. 在 GitHub 仓库 Settings → Environments 创建 `production`，仅允许 `main` 分支部署。自动发布环境不要添加人工审批要求。
2. 为当前 Vercel 项目创建专用部署 token，将其保存为 `production` 的 `VERCEL_TOKEN` secret。将本地 `.vercel/project.json` 的组织和项目标识分别保存为 `VERCEL_ORG_ID`、`VERCEL_PROJECT_ID` secrets。不要将这些值写入源码、工作流、聊天或 `.env.example`。
3. 在 Vercel production 保留上文的运行环境配置。工作流使用 `vercel pull`、`vercel build --prod`、`vercel deploy --prebuilt --prod`，产物不上传为 GitHub artifact，日志不打印环境文件。Actions 与 Vercel 都使用 Node.js 24；CLI 固定为已验收版本。
4. 推送 `main` 后，在 Actions 查看 `Verify` 与 `Deploy production`。成功的部署记录和步骤摘要包含产物地址与提交 SHA；工作流还检查首页、控制台、密钥、账单、后台和 OpenAPI 地址。检查仅验证 Web 与公开接口可访问，资金链路仍需真实钱包验收。

`vercel.json` 将 `git.deploymentEnabled` 设置为 `false`，由 Actions 统一控制部署。不要另外启用 Vercel Git 自动部署或调用 Deploy Hook，否则会绕过校验或重复发布。发布前检查提交仍是最新 `main`，防止旧工作流重试覆盖新版本。正在进行的发布不会被后续推送中断。

### 独立执行数据库迁移

1. 创建 GitHub `production-migrations` Environment，仅允许 `main`。将目标数据库的直连地址保存为该环境的 `DATABASE_URL` secret。不要使用本机数据库、连接池地址或其他链与资产的账本；环境可以按团队要求增加审批人。
2. 先检查迁移内容、目标账本与备份。在 Actions 选择 `DB Migrate` → Run workflow，选择 `main`，输入 `migrate`。此步骤才执行 `pnpm db:migrate`，随后检查 Prisma 迁移状态。推送代码不会触发它。
3. 新版本依赖数据库变更时，先单独完成迁移，再运行对应 `main` 提交的发布工作流。部署与迁移共享并发锁，避免同一时间运行，但工作流不会替操作者判断业务变更能否兼容旧版本。

迁移不会部署或替换托管合约，也不会转换历史余额。启用模型预付路由还须满足 [MODEL_ROUTING.md](../MODEL_ROUTING.md) 的新版合约和独立账本要求。Vercel Web 自动发布也不会启动或更新常驻结算 worker。

上述命令模式遵循 [Vercel GitHub Actions 指南](https://vercel.com/kb/guide/how-can-i-use-github-actions-with-vercel)。专用 token 的有效期和轮换由维护者管理；到期前更新 GitHub secret 即可，不需修改工作流。

单机入口限流使用内存。多Web实例需要模板支持的共享Redis限流，只信任部署平台覆盖的IP头。已验证的 API Key、连接器凭证和已登录钱包按凭证单独计数（`RATE_LIMIT_CREDENTIAL_REQUESTS`，默认每窗口 600 次），不再与同一代理后的其他客户端共用 IP 配额；匿名请求与认证失败仍按 IP 计数。高并发时在 `DATABASE_URL` 设置 `connection_limit` 与 `pool_timeout`，所有进程的连接总数应低于数据库 `max_connections`。数据库和签名发送已有跨进程锁，多实例故障切换仍需压力与故障注入验收。

## Docker

`docker-compose.yml`只启动本地数据库。`docker-compose.app.yml`用于 EVM 常驻部署，包含迁移、Web和worker。需配置 `POSTGRES_PASSWORD`、`SESSION_PASSWORD`、`ESCROW_OWNER_PRIVATE_KEY`、`CHAIN_CONFIG_JSON` 与 `APP_ORIGIN`；可选钱包 Project ID 通过同名 build arg 注入。容器镜像和目标主机部署尚未验收。

## 发布验收

先运行 `pnpm verify`；本地 `pnpm test:e2e` 必须在显式设置 `TOKEN2API_MODE=local`、`ALLOW_DEMO=true` 的隔离数据库与数据目录中运行。再在目标环境以两个真实钱包验证登录、授权、锁预算、真实网关调用、计费、分账、退款和提现。模拟响应和演示身份不能替代真实钱包与上游验收。当前代码支持目标链部署，但本次改动不自动发布或发送真实资金交易。
