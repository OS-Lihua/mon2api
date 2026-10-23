# Token2API

AI 资源市场 · 多链结算平台。新部署默认 Base + USDC，支持配置 USDT；业务报价与结算使用选定资产，Gas 使用该链原生代币。支持 Ethereum 主网、Base、Arbitrum、Optimism、BNB Smart Chain（BSC）、Polygon、Avalanche 和 Robinhood Chain，按链使用原生代币及已配置的 USDT、USDC 合约。

每套运行实例固定一条链、一种资产和一个托管合约，并使用独立数据库。当前不在同一实例内切换多个资金账本，不自动换币或跨链。链、稳定币版本及合约精度的配置见[多链结算](docs/MULTICHAIN.md)。加入支持列表不代表已经部署或完成真实资金验收。

调用者创建 API Key，勾选该 Key 允许使用的模型；所有模型 Key 共用当前钱包的统一预付余额。管理员发布平台统一模型报价并配置上游路由，调用者无需选择供应商。每次调用在后台固定提供者、资源与两份报价快照，确认最大费用预留后再执行。账本使用结算资产的整数百万分之一，价格按百万 Token 计；链上转账通过共享工具按 `tokenDecimals` 换算。原有会话、密钥与余额保持原规则。新预付功能需要新版托管合约；新合约必须使用独立数据库，不能改绑或转换旧余额。完整说明见[模型 Key 与路由](docs/MODEL_ROUTING.md)。

商家可通过[本机连接器](docs/LOCAL_CONNECTOR.md)保留上游 Key，并让持续运行的 CLI 服务接收平台任务。安装 Node.js 24 或更高版本后，在“接入资源”中选择本机模式，复制凭证及网页提供的 `npx` 启动命令，可在任意目录运行，无需下载项目或配置数据库。独立安装包由当前平台提供，不依赖 npm 注册表发布。连接器自动读取网关模型列表，再在网页选择模型和报价上架，无需手填模型 ID。Magpie 默认地址为 `http://127.0.0.1:3425/v1`。离线后停止接单，已执行但用量不确定的请求保留预算等待核对。

## 本地启动

商家也可使用完整的 [`token2api` CLI](docs/CLI.md)，通过终端钱包签名登录、配置网关、设置报价并上架，无需网页。AI 可读取命令 Schema、预演和管理公开配置；私钥、密码及网关 Key 必须由用户本人在真实终端隐藏输入。私钥仅用于本地签名，本机资源凭证加密保存；普通命令默认输出 JSON，持续接单输出 NDJSON。

需要 Node.js 24+、pnpm 11、Docker。在仓库根目录执行：

```bash
pnpm install
pnpm setup
# 配置链、资产、部署密钥与独立数据库，详见 docs/MULTICHAIN.md
pnpm deploy:evm
pnpm dev
```

调用者在“模型市场”查看管理员发布的模型与统一报价，在“API 密钥”创建 Key 并授权模型。商家在“我的资源”通过 gateway 或 pool connector 接入资源；管理员再将资源映射到平台模型。没有真实模型或业务记录时显示空状态。钱包签名登录保持不变；用户端不启用演示登录。

打开[本地首页](http://localhost:3000)或[业务控制台](http://localhost:3000/console)。`setup` 创建 `.env`、启动 PostgreSQL 并执行迁移。配置 `TOKEN2API_MODE=evm`、`SETTLEMENT_CHAIN_ID`、`SETTLEMENT_ASSET` 和独立运行目录后，`deploy:evm` 写入公开部署信息。`dev` 启动 Web 和结算 worker。实际可用的链和资产以 `/api/v1/network` 为准。

控制台围绕“创建 Key → 授权模型 → 充值 → 调用”组织。模型市场每页 9 条，支持搜索、可用状态筛选和输入/输出价格排序。Key 明确授权 1–100 个模型，新增模型不会自动授权；完整 Key 仅显示一次。调用实验室选择 Key 和已授权模型，平台负责上游路由。账单显示调用费用、预留、待核对和结算状态；未用预留退回预付余额，原会话退款仍转入可提现余额。统计基于当前最多 200 条请求与 100 个会话，前端分页不代表完整历史。网络、结算资产与 Gas 币种明确分开；未知用量不显示零费用。

首页 `/` 围绕“创建 Key、授权模型、平台路由”说明产品，并提供调用者、商家和管理员入口。链目录表示适配范围，实际可用网络和资产以当前部署为准。网页操作见[下游指南](docs/CONSUMER_GUIDE.md#网页使用)和[商家指南](docs/MERCHANT_GUIDE.md#网页使用)。

界面使用 Token2API 独立标志、蓝色操作主色、灰白内容区和深蓝导航。成功、待核对、错误分别使用独立语义色。首页以多链节点、结算中心和独立链色说明支持范围。素材说明见[品牌资料](docs/BRAND_ASSETS.md)。

品牌标志以两条圆润的相向折带表达连接与交换，统一圆角与间距，使用青绿与白色的无描边轮廓。首页、控制台与首屏图形保持一致。透明矢量源为 [`public/token2api-mark.svg`](public/token2api-mark.svg)，透明背景的浏览器图标为 [`public/icon.svg`](public/icon.svg)，ICO 包含 16、32、48 像素版本。品牌标志保留青绿配色，产品界面使用蓝色主操作与灰白内容区；不使用圆角底板。首页省去 BETA、英文眉题、装饰标签与重复标语，保留功能说明和必要的 API 配置提示。

概览精简重复的辅助说明，空状态只保留必要标题。统计范围直接显示，并保留屏幕阅读器说明；输入与输出明细、待结算金额仅在非零时显示。价格单位按当前结算资产显示，本地环境保留测试标识。

模型市场、密钥和账单复用搜索、筛选和分页控件。后台管理模型报价、上游路由、网关及代理白名单。调用实验室显示真实的整段响应执行状态，支持 Ctrl / ⌘ + Enter 发送，失败时引导先核对账单。组件规范见[前端交互说明](docs/FRONTEND.md)。

调用实验室的 Key 与模型选择器复用现有 Radix 组件，支持方向键、文字定位和 Escape。Key 创建与权限编辑使用可搜索的复选框列表。没有授权模型时禁止发送；提交中防止重复操作。原生 dialog 补齐 Tab 双向循环、Escape 关闭和触发点焦点恢复。

## 商家资源接入

商家统一使用网关地址和模型调用 API Key 接入，支持两种部署方式：

- **本机连接器**：上游 Key 保留在商家机器，由 CLI 出站接单并调用网关。
- **平台直连**：填写上游服务地址和 API Key，读取模型列表后选择模型、报价和并发上限。平台加密保存调用 Key。

网关地址、端口和 API 基础路径可自定义，Magpie 地址仅为示例；根地址默认使用 `/v1`，自定义路径原样保留。网关须支持文本 Chat Completions、流式响应和最终 Token usage。平台直连的完整 API 基础地址须由当前管理员钱包在 `/admin` 加入白名单；可选 HTTP/HTTPS 代理，代理地址也须单独批准。调用 Key 和代理认证信息加密保存。后台可停用地址并查看关联资源；本机连接器的真实上游不在平台直连核验范围内。升级步骤见[接入管理后台](docs/ADMIN_GUIDE.md)。Token2API 使用钱包签名登录，不提供第三方账号登录或授权，也不接收账号 access token、refresh token 或上游管理密钥。

REST 创建资源使用 `kind: "gateway"`，资源查询支持 `q`、`kind`。模型与连接凭证在上架后不可更改。升级数据库时运行 `pnpm db:migrate`；生产迁移独立执行。

## 钱包连接

复用 MIT 开源的 [RainbowKit](https://github.com/rainbow-me/rainbowkit) 和 [wagmi](https://github.com/wevm/wagmi)，由所选钱包连接器签名和发送交易。钱包选择、账户菜单、断开连接、中文签名引导和网络切换使用套件现有能力。后端保留一次性挑战签名和 iron-session 登录会话，连接成功后仍需签名验证身份。

依赖版本遵循 RainbowKit 的 wagmi 2.x 兼容范围。仓库显式补齐钱包 SDK 打包所需的 x402 可选 peer；这不新增 x402 收费接口，现有预算结算协议保持不变。

- 不配置服务账号即可连接已安装的 MetaMask、Rabby 等 EIP-6963 浏览器钱包；另有 Rabby 安装入口和通用注入连接器。
- 在 `.env` 配置 `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` 后重新构建，可增加 MetaMask、Rainbow 与通用 WalletConnect 扫码入口。ID 从 [WalletConnect Dashboard](https://dashboard.walletconnect.com) 获取；仓库不包含任何人的项目 ID。
- 钱包按当前部署切换网络，Gas 使用本链原生代币。仅显式设置 `TOKEN2API_MODE=local` 时使用本地链 31337。
- 切换账户或断开钱包会使旧的钱包登录失效，并清理界面中的私密状态；演示身份保持独立。授权、锁定预算等多步操作在每一步前重新核实当前账户与网络。

浏览器选择弹窗和模拟连接器的账号/网络边界已验证。真实扩展钱包签名、手机扫码和测试网资金操作需对应钱包、Project ID 与测试网部署再验收。

| 服务 | 地址或位置 |
| --- | --- |
| Web | `http://localhost:3000` |
| PostgreSQL | `127.0.0.1:55432`，数据库 `token2api` |
| 链与资产 | `CHAIN_CONFIG_JSON` 或公开 `chain.json` |
| 部署信息 | `.runtime/evm/<chainId>-<asset>/chain.json`，仅公开字段 |
| API 规范 | `/api/v1/openapi.json` |

数据库和链必须成对保留。每套部署使用独立 `DATABASE_URL` 和 `TOKEN2API_DATA_DIR`，后端固定绑定链 ID、资产、代币精度与托管合约。切换这些字段时使用新账本。本地演示与故障注入仅接受显式选择的回环链 31337。

## API 调用

资源、Key、余额与账单管理使用钱包签名 Cookie 认证的 `/api/v1`；推理使用独立 API Key。Key 的允许模型由用户明确选择，平台按统一报价路由。旧客户端可继续使用原有预算会话接口。详见[API 总览](docs/API.md)。

在控制台创建模型 Key，并授权可用模型；数据库只保存 Key 哈希。充值后使用返回的 Base URL 和 Key，在请求中指定已授权的平台模型 ID。将下例的 `platform-model-id` 替换为该 Key 已授权的实际 ID。

```bash
curl http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer $TOKEN2API_KEY" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: example-request-0001" \
  -d '{"model":"platform-model-id","messages":[{"role":"user","content":"Explain settlement"}],"max_tokens":512,"stream":true,"stream_options":{"include_usage":true}}'
```

官方 OpenAI SDK 可直接调用兼容接口。下面的示例为每次新调用生成一个请求键；重试同一次调用时须复用原键。服务端会拒绝重复键（409），不会再次调用或扣款。响应丢失后，用原 Key 查询 `GET /api/v1/requests/lookup?idempotency_key=原请求键`，核对请求和费用状态；不要用新键重复付费调用。查询不返回生成文本，404 也不能证明在途调用从未受理。

```ts
import { randomUUID } from "node:crypto";
import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.TOKEN2API_KEY,
  baseURL: "http://localhost:3000/v1",
  maxRetries: 0,
});

const requestKey = randomUUID();
const completion = await client.chat.completions.create(
  {
    model: "platform-model-id",
    messages: [{ role: "user", content: "Explain settlement" }],
    max_tokens: 512,
  },
  { headers: { "Idempotency-Key": requestKey } },
);
console.log(completion.choices[0]?.message.content);
```

`/api/v1` 是兼容前缀。接口只支持文本 Chat Completions，未知参数会明确拒绝。缺少 8 至 128 字符的 `Idempotency-Key` 返回 400。流式响应在 HTTP 200 后仍可能通过 SSE error 报错；收到 `[DONE]` 前不能视为成功，且费用状态以账单为准。

REST 和网页 tRPC 的原始请求体上限为 160 KiB，读取总期限为 10 秒，按实际流字节检查；tRPC 每批最多 10 个操作。推理上游原始响应最多 2 MiB、累计文本最多 64 KiB UTF-8 字节，超限中止且保留待核对预算。带认证的远程代理必须使用 HTTPS，HTTP 认证仅允许回环地址。

## 资金规则

一个会话固定资源、提供者、价格快照和预算，期限一小时。会话 ID 的前 20 字节为消费者钱包地址，后 12 字节由服务端随机生成；合约只接受该钱包开通，防止其他钱包抢先占用 ID。一单位结算资产等于 1,000,000 账本单位；报价按该资产 / 百万 Token 表示，链上精度另按 tokenDecimals 换算。锁定金额由用户自定，不设置 1–100 等业务额度限制；预算和报价可输入至多六位小数，金额不做四舍五入；小额费用保留实际精度。费用采用整数向上取整，平台费为累计消费的5%。链上余额读取失败时显示“暂不可用”，不会显示为零。

请求先原子预留，再依据上游 usage 核销。真实网关按32,768输入Token和输出上限保守预留；上游报告超出预留时进入核对，不能自动超扣。调用总执行期限45秒，到期前180秒停止接单。REST 流式客户端断开后，服务端仍继续等待上游用量；缺失用量、截断和未知结果进入 REVIEW，保留预算，控制台把未知用量标为待核对；worker 标记中断后迟到的上游用量也会写入待核对记录，不自动扣费；运营者依据证据通过 `pnpm review:resolve` 核对。上游报告与平台计量仍受信任，上链摘要不是执行证明。

worker每轮结束后等待10秒，再优先处理待结算与待关闭会话，并分页巡检活跃会话；最多并发处理4个不同会话。业务任务和签名交易先落库，按nonce、累计金额、摘要和链上事件恢复。PostgreSQL锁只保护钱包nonce分配、签名和保存，发送与确认在事务外执行；重试复用相同的签名交易。会话开通确认以托管合约发出的事件、确认数及链上条款为准，兼容合约钱包的转发交易。

正常关闭先停止接单、处理在途请求并结算退款。消费者也可直接调用合约 `requestClose`，120秒窗口后调用 `closeSession`，再 `withdraw`。平台不能无限延迟链上退出；长期网络或运营故障造成的未收回费用由运营者承担。

## 验证

```bash
pnpm verify
# 保持 pnpm dev 运行，在另一终端执行
pnpm test:e2e
# REST 登录、资源管理、权限隔离与账单查询（需要 ALLOW_DEMO=true）
pnpm test:api
```

verify顺序运行格式/lint、TypeScript、Vitest和生产构建。端到端smoke仅允许本地演示模式，覆盖普通和流式调用、用量、重复请求、结算幂等、关闭退款、Key撤销和提供者提现。测试会保留审计账单。

## 文档

- [API 认证、目录与错误处理](docs/API.md)
- [商家资源管理与核账](docs/MERCHANT_GUIDE.md)
- [下游预算、Key 与模型调用](docs/CONSUMER_GUIDE.md)
- [五分钟本地演示与产品主张](docs/PRODUCT_DEMO.md)
- [模型广场、工具导入与多链支付路线](docs/PRODUCT_STRATEGY.md)
- [MVP模块职责](docs/MVP.md)
- [开发任务和验收状态](docs/TASKS.md)
- [号池连接器与用量核对](docs/POOL.md)
- [部署说明](docs/deployment/vercel.md)
- [CI/CD 与可选自动化模板](docs/ci/README.md)：推送 `main` 后自动校验并发布 Vercel；生产数据库迁移独立手动执行。

## 开源基础

基于MIT许可的 [T3 Web API Template](https://github.com/PraxisGrove/t3-web-api-template)，保留原许可。复用Next.js、tRPC、Prisma/PostgreSQL、Zod、官方OpenAI SDK、iron-session、RainbowKit、wagmi、viem和OpenZeppelin。Ganache仅用于本地链和合约测试。资源归属、计费账本和分账规则在本仓库实现。

## 仅预览前端

无需 Docker、数据库或本地链，安装依赖后运行 `NEXT_PUBLIC_UI_PREVIEW=true SKIP_ENV_VALIDATION=1 pnpm dev:web`，访问 `/console` 或直接打开 `/console/market`。控制台各模块使用独立文件路由，支持刷新、深链接和浏览器前进后退；共享布局保留钱包及操作状态。此开关仅在 development 生效；页面明确显示模拟资源，所有后端写入均拒绝执行。
