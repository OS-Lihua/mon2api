# mon2api

AI 资源租赁市场。提供者挂牌号池连接器，开发者锁定预算并通过统一 API 调用；链下计量，链上结算与分账。

当前可运行本地全栈 MVP：资源市场、提供者控制台、调用实验室、API Key、账单、自动结算、退款和提现。演示模型明确输出模拟标记；本地资金操作是真实 EVM 交易，使用无实际价值的 dUSD 测试代币。真实网关和 Monad 测试网需要单独配置及验证。

## 本地启动

需要 Node.js 24+、pnpm 11、Docker。在仓库根目录执行：

```bash
pnpm install
pnpm setup
pnpm dev
```

打开 [本地控制台](http://localhost:3000)。`setup` 创建带随机会话密码的本地 `.env`，启动 PostgreSQL，执行迁移并添加演示资源。`dev` 启动持久化本地 EVM、每10秒运行的结算 worker 和 Web 服务。首次为四个公开测试账户各分配500 dUSD；重启复用部署和账本。

进入使用者演示，创建预算会话并调用模型；切换提供者演示可管理自己的资源和提现。演示签名仅允许回环 chain 31337。真实钱包使用 RainbowKit 钱包选择与签名登录；登录签名不授权代币转账，代币授权和预算锁定需分别确认交易。

## 钱包连接

复用 MIT 开源的 [RainbowKit](https://github.com/rainbow-me/rainbowkit) 和 [wagmi](https://github.com/wevm/wagmi)，由所选钱包连接器签名和发送交易。钱包选择、账户菜单、断开连接、中文签名引导和网络切换使用套件现有能力。后端保留一次性挑战签名和 iron-session 登录会话，连接成功后仍需签名验证身份。

依赖版本遵循 RainbowKit 的 wagmi 2.x 兼容范围。仓库显式补齐钱包 SDK 打包所需的 x402 可选 peer；这不新增 x402 收费接口，现有预算结算协议保持不变。

- 不配置服务账号即可连接已安装的 MetaMask、Rabby 等 EIP-6963 浏览器钱包；另有 Rabby 安装入口和通用注入连接器。
- 在 `.env` 配置 `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` 后重新构建，可增加 MetaMask、Rainbow 与通用 WalletConnect 扫码入口。ID 从 [WalletConnect Dashboard](https://dashboard.walletconnect.com) 获取；仓库不包含任何人的项目 ID。
- 当前仅配置本地 EVM（31337）或部署所在的 Monad 测试网（10143）。手机无法访问电脑的回环 RPC，扫码端到端验证须使用可访问的测试网部署。
- 切换账户或断开钱包会使旧的钱包登录失效，并清理界面中的私密状态；演示身份保持独立。授权、锁定预算等多步操作在每一步前重新核实当前账户与网络。

浏览器选择弹窗和模拟连接器的账号/网络边界已验证。真实扩展钱包签名、手机扫码和测试网资金操作需对应钱包、Project ID 与测试网部署再验收。

| 服务 | 地址或位置 |
| --- | --- |
| Web | `http://localhost:3000` |
| PostgreSQL | `127.0.0.1:55432`，数据库 `mon2api` |
| 本地 EVM | `http://127.0.0.1:8545`，chain 31337 |
| 部署信息 | `.runtime/chain.json`，仅公开字段 |
| 链状态 | `.runtime/ganache/` |
| API 规范 | `/api/v1/openapi.json` |

数据库和链必须成对保留，不能只删除其中一个后继续使用原账本。每套部署使用独立 `DATABASE_URL` 和 `MON2API_DATA_DIR`；后端验证数据库与部署的绑定。

## API 调用

在控制台为自己的活跃会话创建平台 Key。Key只显示一次，绑定一个模型、提供者和预算；数据库只保存其哈希。

```bash
curl http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer $MON2API_KEY" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: example-request-0001" \
  -d '{"model":"mon2api-demo","messages":[{"role":"user","content":"Explain settlement"}],"max_tokens":512,"stream":true,"stream_options":{"include_usage":true}}'
```

官方 OpenAI SDK 的 `baseURL` 设为 `http://localhost:3000/v1`，关闭客户端自动重试。`/api/v1` 是兼容前缀。只支持文本 Chat Completions，未知参数明确拒绝；重复幂等键返回409，不重复调用或扣款。流式响应开始后发生的错误由 SSE error 返回。

## 资金规则

一个会话固定资源、提供者、价格快照和预算，期限一小时。1 dUSD等于1,000,000最小单位；报价单位为micro dUSD / 百万Token。费用采用整数向上取整，平台费为累计消费的5%。

请求先原子预留，再依据上游 usage 核销。真实网关按32,768输入Token和输出上限保守预留；上游报告超出预留时进入核对，不能自动超扣。调用总执行期限45秒，到期前180秒停止接单。缺失用量、截断和未知结果进入 REVIEW，保留预算；运营者依据证据通过 `pnpm review:resolve` 核对。上游报告与平台计量仍受信任，上链摘要不是执行证明。

worker每10秒处理结算。outbox先落库再发交易，按nonce、累计金额、摘要和链上事件恢复。PostgreSQL锁串行化Web与worker对同一签名者的发送。

正常关闭先停止接单、处理在途请求并结算退款。消费者也可直接调用合约 `requestClose`，120秒窗口后调用 `closeSession`，再 `withdraw`。平台不能无限延迟链上退出；长期网络或运营故障造成的未收回费用由运营者承担。

## 验证

```bash
pnpm verify
# 保持 pnpm dev 运行，在另一终端执行
pnpm test:e2e
```

verify顺序运行格式/lint、TypeScript、Vitest和生产构建。端到端smoke仅允许本地演示模式，覆盖普通和流式调用、用量、重复请求、结算幂等、关闭退款、Key撤销和提供者提现。测试会保留审计账单。

## 文档

- [MVP模块职责](docs/MVP.md)
- [开发任务和验收状态](docs/TASKS.md)
- [号池连接器与用量核对](docs/POOL.md)
- [部署说明](docs/deployment/vercel.md)
- [可选自动化模板](docs/ci/README.md)

## 开源基础

基于MIT许可的 [T3 Web API Template](https://github.com/PraxisGrove/t3-web-api-template)，保留原许可。复用Next.js、tRPC、Prisma/PostgreSQL、Zod、官方OpenAI SDK、iron-session、RainbowKit、wagmi、viem和OpenZeppelin。Ganache仅用于本地链和合约测试。资源归属、计费账本和分账规则在本仓库实现。
