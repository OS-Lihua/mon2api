# mon2api

AI 资源租赁市场。提供者挂牌号池连接器，开发者锁定预算并通过统一 API 调用；链下计量，链上结算与分账。

当前可运行本地全栈 MVP：资源市场、提供者控制台、调用实验室、API Key、账单、自动结算、退款和提现。演示模型明确输出模拟标记；本地资金操作是真实 EVM 交易，使用无实际价值的 dUSD 测试代币。新版合约已在 Monad 测试网独立完成链上资金验证，尚未接入测试网 Web/数据库、真实浏览器钱包或真实网关；证据见[演示文档](docs/PRODUCT_DEMO.md#monad-测试网合约证据)。

## 本地启动

需要 Node.js 24+、pnpm 11、Docker。在仓库根目录执行：

```bash
pnpm install
pnpm setup
pnpm dev
```

打开 [本地控制台](http://localhost:3000)。`setup` 创建带随机会话密码的本地 `.env`，启动 PostgreSQL，执行迁移并添加演示资源。`dev` 启动持久化本地 EVM、每10秒运行的结算 worker 和 Web 服务。首次为四个公开测试账户各分配500 dUSD；重启复用部署和账本。

控制台概览以“资源 → 预算 → 用量 → 结算”展示使用路径，并根据活跃预算会话引导前往市场或继续调用。市场卡片并列显示提供者挂牌的输入和输出单价（dUSD / 百万 Token），创建预算时再次展示价格快照；模型 ID 由提供者声明。调用后可直接跳转调用账单，账单页可快速定位会话、请求与链上结算。模拟资源无官方同款；连接器模型身份未核验，均无可比官方参考价。本地 dUSD 无兑付价值，不与美元价格比较。进入使用者演示，创建预算会话并调用模型；切换提供者演示可管理自己的资源和提现。概览和账单中的统计基于当前已加载的最近 200 条相关请求和最近 100 个相关会话，并非完整历史总账。桌面账单默认展示最近 5 个会话、8 条请求和 8 笔结算；API 密钥页默认展示最近 8 个密钥，点击“查看全部”可分别展开当前已加载的记录。待核对用量与无法收回的结算会分别标记，未知 Token 用量不会显示为零。演示签名仅允许回环 chain 31337。真实钱包使用 RainbowKit 钱包选择与签名登录；登录签名不授权代币转账，代币授权和预算锁定需分别确认交易。

界面参考 [Monad 官方视觉体系](https://monad.xyz/brand-and-media-kit)，采用鲜紫、浅薰衣草紫、近黑导航与等宽标签；概览在宽屏并列展示操作入口和结算流程。资源市场支持实时显示搜索结果数量与一键清空；手机端提供折叠导航、可横向滚动的表格和更大的操作按钮。

品牌标志以两条圆润的相向折带表达连接与交换，使用薰衣草紫与白色，侧栏和浏览器图标保持一致。矢量源文件为 [`public/mon2api-mark.svg`](public/mon2api-mark.svg)。

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

数据库和链必须成对保留，不能只删除其中一个后继续使用原账本。每套部署使用独立 `DATABASE_URL` 和 `MON2API_DATA_DIR`；后端验证数据库与部署的绑定。旧托管合约没有会话 ID 所有权保护，服务端会拒绝在旧部署新开会话；已有会话仍可结算、关闭、提现。本次展示使用干净的独立数据库 `mon2api_presentation_20261017` 与 `.runtime/presentation-20261017`；已验证的 `mon2api_showcase_20261017`、原账本及各自链数据均保留。

## API 调用

在控制台为自己的活跃会话创建平台 Key。Key只显示一次，绑定一个模型、提供者和预算；数据库只保存其哈希。

```bash
curl http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer $MON2API_KEY" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: example-request-0001" \
  -d '{"model":"mon2api-demo","messages":[{"role":"user","content":"Explain settlement"}],"max_tokens":512,"stream":true,"stream_options":{"include_usage":true}}'
```

官方 OpenAI SDK 可直接调用兼容接口。下面的示例为每次新调用生成一个请求键；重试同一次调用时须复用原键。服务端会拒绝重复键（409），不会再次调用或扣款。因此，响应丢失后不要用新键重试：用原键确认请求是否已受理，再按时间和模型核对账单状态，确认结果后才能发起新调用。

```ts
import { randomUUID } from "node:crypto";
import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.MON2API_KEY,
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

一个会话固定资源、提供者、价格快照和预算，期限一小时。会话 ID 的前 20 字节为消费者钱包地址，后 12 字节由服务端随机生成；合约只接受该钱包开通，防止其他钱包抢先占用 ID。1 dUSD等于1,000,000最小单位；报价单位为micro dUSD / 百万Token。预算和报价可输入至多六位小数，金额不做四舍五入；小额费用保留实际精度。费用采用整数向上取整，平台费为累计消费的5%。链上余额读取失败时显示“暂不可用”，不会显示为零。

请求先原子预留，再依据上游 usage 核销。真实网关按32,768输入Token和输出上限保守预留；上游报告超出预留时进入核对，不能自动超扣。调用总执行期限45秒，到期前180秒停止接单。REST 流式客户端断开后，服务端仍继续等待上游用量；缺失用量、截断和未知结果进入 REVIEW，保留预算，控制台把未知用量标为待核对；worker 标记中断后迟到的上游用量也会写入待核对记录，不自动扣费；运营者依据证据通过 `pnpm review:resolve` 核对。上游报告与平台计量仍受信任，上链摘要不是执行证明。

worker每10秒优先处理待结算与待关闭会话，并分页巡检活跃会话；outbox先落库再发交易，按nonce、累计金额、摘要和链上事件恢复。PostgreSQL锁串行化Web与worker对同一签名者的发送。会话开通确认以托管合约发出的事件、确认数及链上条款为准，兼容合约钱包的转发交易。

正常关闭先停止接单、处理在途请求并结算退款。消费者也可直接调用合约 `requestClose`，120秒窗口后调用 `closeSession`，再 `withdraw`。平台不能无限延迟链上退出；长期网络或运营故障造成的未收回费用由运营者承担。

## 验证

```bash
pnpm verify
# 保持 pnpm dev 运行，在另一终端执行
pnpm test:e2e
```

verify顺序运行格式/lint、TypeScript、Vitest和生产构建。端到端smoke仅允许本地演示模式，覆盖普通和流式调用、用量、重复请求、结算幂等、关闭退款、Key撤销和提供者提现。测试会保留审计账单。

## 文档

- [五分钟本地演示与产品主张](docs/PRODUCT_DEMO.md)
- [模型广场、工具导入、Monad 与支付路线](docs/PRODUCT_STRATEGY.md)
- [MVP模块职责](docs/MVP.md)
- [开发任务和验收状态](docs/TASKS.md)
- [号池连接器与用量核对](docs/POOL.md)
- [部署说明](docs/deployment/vercel.md)
- [可选自动化模板](docs/ci/README.md)

## 开源基础

基于MIT许可的 [T3 Web API Template](https://github.com/PraxisGrove/t3-web-api-template)，保留原许可。复用Next.js、tRPC、Prisma/PostgreSQL、Zod、官方OpenAI SDK、iron-session、RainbowKit、wagmi、viem和OpenZeppelin。Ganache仅用于本地链和合约测试。资源归属、计费账本和分账规则在本仓库实现。
