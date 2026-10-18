# Token2API

AI 资源市场 · 多链结算平台。支持 Ethereum 主网、Base、Arbitrum、Optimism、BNB Smart Chain（BSC）、Polygon、Avalanche 和 Robinhood Chain，按链使用原生代币及已配置的 USDT、USDC 合约。

每套运行实例固定一条链、一种资产和一个托管合约，并使用独立数据库。当前不在同一实例内切换多个资金账本，不自动换币或跨链。链、稳定币版本及合约精度的配置见[多链结算](docs/MULTICHAIN.md)。加入支持列表不代表已经部署或完成真实资金验收。

买方锁定预算并确认后，直接获得 `connection: {base_url, key, model}`。账本和报价按结算资产的整数百万分之一计量；链上转账按 `tokenDecimals` 换算。旧账本保持原资产与金额，不能更名或直接复用。为兼容现有客户端，保留 `MON2API_*` 环境变量及 `mon2api` 协议字段；产品名称为 Token2API。

商家可通过[本机连接器](docs/LOCAL_CONNECTOR.md)保留上游 Key，并让持续运行的 CLI 服务接收平台任务。安装 Node.js 24 或更高版本后，在“接入资源”中选择本机模式，复制凭证及网页提供的 `npx` 启动命令，可在任意目录运行，无需下载项目或配置数据库。独立安装包由当前平台提供，不依赖 npm 注册表发布。连接器自动读取网关模型列表，再在网页选择模型和报价上架，无需手填模型 ID。Magpie 默认地址为 `http://127.0.0.1:3425/v1`。离线后停止接单，已执行但用量不确定的请求保留预算等待核对。

## 本地启动

需要 Node.js 24+、pnpm 11、Docker。在仓库根目录执行：

```bash
pnpm install
pnpm setup
# 配置链、资产、部署密钥与独立数据库，详见 docs/MULTICHAIN.md
pnpm deploy:evm
pnpm dev
```

用户端仅展示数据库中的网关资源及其关联会话、请求、密钥和结算。没有网关资源或业务记录时显示空状态。使用者需连接钱包并签名登录；接入本机资源时，先在网页创建连接草稿，在本机 CLI 指定上游地址并输入 Key，自动读取模型后再选择模型与报价上架；选择平台直连时，在网页提交上游地址和 Key。演示资源不显示在用户端，本地演示测试需单独显式初始化。旧的演示登录在用户端按未登录处理。

打开[本地首页](http://localhost:3000)或[业务控制台](http://localhost:3000/console)。`setup` 创建 `.env`、启动 PostgreSQL 并执行迁移。配置 `MON2API_MODE=evm`、`SETTLEMENT_CHAIN_ID`、`SETTLEMENT_ASSET` 和独立运行目录后，`deploy:evm` 写入公开部署信息。`dev` 启动 Web 和结算 worker。实际可用的链和资产以 `/api/v1/network` 为准。

控制台概览以“资源 → 预算 → 用量 → 结算”展示使用路径，并根据活跃预算会话引导前往市场或继续调用。市场卡片并列显示提供者挂牌的输入和输出单价（当前结算资产 / 百万 Token），创建预算时再次展示价格快照；模型 ID 由提供者声明。调用后可直接跳转调用账单，账单页可快速定位会话、请求与链上结算。模拟资源无官方同款；连接器模型身份未核验，均无可比官方参考价。本地 dUSD 无兑付价值，不与美元价格比较。连接钱包后，可创建预算会话并调用网关资源，也可管理自己的资源和提现。概览和账单中的统计基于当前已加载的最近 200 条相关请求和最近 100 个相关会话，并非完整历史总账。桌面账单默认展示最近 5 个会话、8 条请求和 8 笔结算；API 密钥页默认展示最近 8 个密钥，点击“查看全部”可分别展开当前已加载的记录。待核对用量与无法收回的结算会分别标记，未知 Token 用量不会显示为零。演示签名仅允许回环 chain 31337。真实钱包使用 RainbowKit 钱包选择与签名登录；登录签名不授权代币转账，代币授权和预算锁定需分别确认交易。

首页 `/` 围绕“AI 资源，多链结算”说明产品。结算网络目录列出各链原生代币，稳定币单独说明按合约开通；功能卡片、使用步骤、常见问题和 API 示例按同一条使用路径组织。控制台“当前市场”显示实际网络、结算资产和手续费币种，创建预算时再次确认。网页操作见[下游指南](docs/CONSUMER_GUIDE.md#网页使用)和[商家指南](docs/MERCHANT_GUIDE.md#网页使用)。

界面使用 Token2API 独立标志、青绿色操作主色和深蓝灰导航。首页以多链节点、结算中心和独立链色说明支持范围。素材说明见[品牌资料](docs/BRAND_ASSETS.md)。

品牌标志以两条圆润的相向折带表达连接与交换，统一圆角与间距，使用青绿与白色的无描边轮廓。首页、控制台与首屏图形保持一致。透明矢量源为 [`public/token2api-mark.svg`](public/token2api-mark.svg)，透明背景的浏览器图标为 [`public/icon.svg`](public/icon.svg)，ICO 包含 16、32、48 像素版本。浅色页面使用青绿与深蓝灰，深色侧栏使用浅青绿与白色；不使用圆角底板。首页省去 BETA、英文眉题、装饰标签与重复标语，保留功能说明和必要的 API 配置提示。

概览精简重复的辅助说明，空状态只保留必要标题。统计范围可悬停查看，并保留屏幕阅读器说明；输入与输出明细、待结算金额仅在非零时显示。价格单位按当前结算资产显示，本地环境保留测试标识。

预算会话使用统一的下拉选择器，选项显示说明和选中标记。支持方向键选择、输入文字定位和 Escape 关闭菜单；弹窗内先关闭菜单，再按 Escape 关闭弹窗。没有活跃预算会话时，调用配置中的选择器显示空状态并禁用。

## 商家资源接入

「接入资源」提供两种方式，并在资源列表中分别标记：

- **API 接入**：填写上游服务地址、API Key、实际模型 ID、输入/输出报价和并发上限。
- **OAuth 号池**：先在 vm2api 等号池网关完成账号授权，再创建仅绑定目标账号池的专用推理 Key；在 Token2API 填写该网关地址、专用 Key、模型 ID 和报价。不要填写网关管理密钥、账号密码、OAuth access token 或 refresh token。

两种方式均要求网关支持 `POST /v1/chat/completions`（包括流式响应及 Token usage），且 origin 已在 `UPSTREAM_ALLOWED_ORIGINS` 中配置。OAuth 授权、令牌刷新、账号健康和调度由号池网关管理；Token2API 保存接入类型和加密后的推理 Key，处理资源挂牌、预算、计量和结算。接入类型由商家声明，不表示平台已核验账号授权。尚未配置真实号池网关时，不能将本地界面验证视为真实 OAuth 账号调用验收。

REST 创建资源沿用 `kind: "gateway"`，新增 `connectionMode: "api" | "oauth_pool"`，省略时默认为 `api`。`GET /api/v1/resources` 和 `GET /api/v1/merchant/resources` 支持按 `connectionMode` 筛选。接入类型与连接凭证在上架后不可更改；更换时请暂停旧资源并新建资源。升级已有本地库时运行 `pnpm db:migrate`；生产迁移需按独立迁移流程执行。

## 钱包连接

复用 MIT 开源的 [RainbowKit](https://github.com/rainbow-me/rainbowkit) 和 [wagmi](https://github.com/wevm/wagmi)，由所选钱包连接器签名和发送交易。钱包选择、账户菜单、断开连接、中文签名引导和网络切换使用套件现有能力。后端保留一次性挑战签名和 iron-session 登录会话，连接成功后仍需签名验证身份。

依赖版本遵循 RainbowKit 的 wagmi 2.x 兼容范围。仓库显式补齐钱包 SDK 打包所需的 x402 可选 peer；这不新增 x402 收费接口，现有预算结算协议保持不变。

- 不配置服务账号即可连接已安装的 MetaMask、Rabby 等 EIP-6963 浏览器钱包；另有 Rabby 安装入口和通用注入连接器。
- 在 `.env` 配置 `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` 后重新构建，可增加 MetaMask、Rainbow 与通用 WalletConnect 扫码入口。ID 从 [WalletConnect Dashboard](https://dashboard.walletconnect.com) 获取；仓库不包含任何人的项目 ID。
- 钱包按当前部署切换网络，Gas 使用本链原生代币。仅显式设置 `MON2API_MODE=local` 时使用本地链 31337。
- 切换账户或断开钱包会使旧的钱包登录失效，并清理界面中的私密状态；演示身份保持独立。授权、锁定预算等多步操作在每一步前重新核实当前账户与网络。

浏览器选择弹窗和模拟连接器的账号/网络边界已验证。真实扩展钱包签名、手机扫码和测试网资金操作需对应钱包、Project ID 与测试网部署再验收。

| 服务 | 地址或位置 |
| --- | --- |
| Web | `http://localhost:3000` |
| PostgreSQL | `127.0.0.1:55432`，数据库 `mon2api` |
| 链与资产 | `CHAIN_CONFIG_JSON` 或公开 `chain.json` |
| 部署信息 | `.runtime/evm/<chainId>-<asset>/chain.json`，仅公开字段 |
| API 规范 | `/api/v1/openapi.json` |

数据库和链必须成对保留。每套部署使用独立 `DATABASE_URL` 和 `MON2API_DATA_DIR`，后端固定绑定链 ID、资产、代币精度与托管合约。切换这些字段时使用新账本。本地演示与故障注入仅接受显式选择的回环链 31337。

## API 调用

商家资源管理、消费者预算会话、Key 和账单查询使用 `/api/v1`，通过钱包签名登录后的 Cookie 认证。推理使用绑定会话的独立 API Key。接入步骤见 [API 总览](docs/API.md)、[商家指南](docs/MERCHANT_GUIDE.md) 和 [下游指南](docs/CONSUMER_GUIDE.md)；完整契约由 `/api/v1/openapi.json` 提供。

在控制台为自己的活跃会话创建平台 Key。Key只显示一次，绑定一个模型、提供者和预算；数据库只保存其哈希。

```bash
curl http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer $TOKEN2API_KEY" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: example-request-0001" \
  -d '{"model":"mon2api-demo","messages":[{"role":"user","content":"Explain settlement"}],"max_tokens":512,"stream":true,"stream_options":{"include_usage":true}}'
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
    model: "mon2api-demo",
    messages: [{ role: "user", content: "Explain settlement" }],
    max_tokens: 512,
  },
  { headers: { "Idempotency-Key": requestKey } },
);
console.log(completion.choices[0]?.message.content);
```

`/api/v1` 是兼容前缀。接口只支持文本 Chat Completions，未知参数会明确拒绝。缺少 8 至 128 字符的 `Idempotency-Key` 返回 400。流式响应在 HTTP 200 后仍可能通过 SSE error 报错；收到 `[DONE]` 前不能视为成功，且费用状态以账单为准。

## 资金规则

一个会话固定资源、提供者、价格快照和预算，期限一小时。会话 ID 的前 20 字节为消费者钱包地址，后 12 字节由服务端随机生成；合约只接受该钱包开通，防止其他钱包抢先占用 ID。一单位结算资产等于 1,000,000 账本单位；报价按该资产 / 百万 Token 表示，链上精度另按 tokenDecimals 换算。预算和报价可输入至多六位小数，金额不做四舍五入；小额费用保留实际精度。费用采用整数向上取整，平台费为累计消费的5%。链上余额读取失败时显示“暂不可用”，不会显示为零。

请求先原子预留，再依据上游 usage 核销。真实网关按32,768输入Token和输出上限保守预留；上游报告超出预留时进入核对，不能自动超扣。调用总执行期限45秒，到期前180秒停止接单。REST 流式客户端断开后，服务端仍继续等待上游用量；缺失用量、截断和未知结果进入 REVIEW，保留预算，控制台把未知用量标为待核对；worker 标记中断后迟到的上游用量也会写入待核对记录，不自动扣费；运营者依据证据通过 `pnpm review:resolve` 核对。上游报告与平台计量仍受信任，上链摘要不是执行证明。

worker每10秒优先处理待结算与待关闭会话，并分页巡检活跃会话；outbox先落库再发交易，按nonce、累计金额、摘要和链上事件恢复。PostgreSQL锁串行化Web与worker对同一签名者的发送。会话开通确认以托管合约发出的事件、确认数及链上条款为准，兼容合约钱包的转发交易。

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
- [可选自动化模板](docs/ci/README.md)

## 开源基础

基于MIT许可的 [T3 Web API Template](https://github.com/PraxisGrove/t3-web-api-template)，保留原许可。复用Next.js、tRPC、Prisma/PostgreSQL、Zod、官方OpenAI SDK、iron-session、RainbowKit、wagmi、viem和OpenZeppelin。Ganache仅用于本地链和合约测试。资源归属、计费账本和分账规则在本仓库实现。

## 仅预览前端

无需 Docker、数据库或本地链，安装依赖后运行 `NEXT_PUBLIC_UI_PREVIEW=true SKIP_ENV_VALIDATION=1 pnpm dev:web`，访问 `/console`。此开关仅在 development 生效；页面明确显示模拟资源，所有后端写入均拒绝执行。
