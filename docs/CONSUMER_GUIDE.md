> 按当前部署的结算资产报价与计费。读取 `/network` 的 `chainId`、`asset`、`tokenDecimals`、`ledgerUnit` 和 `balanceUnit`，按[多链结算](./MULTICHAIN.md)换算金额。

# 下游使用指南

下游使用者先选择资源、锁定预算，再用独立 Key 调用模型。一个预算会话固定一位商家、一份资源和一份价格快照，不自动切换商家或模型。

## 网页使用

1. 打开控制台，在“当前市场”核对结算网络、结算资产和网络手续费币种。首页的链目录表示已适配范围，不表示当前市场同时开通了所有链或资产。
2. 连接钱包并签名登录。在“资源市场”选择模型和提供者，核对输入、输出报价。
3. 创建预算会话。弹窗会再次显示网络、资产和价格；使用稳定币时还会显示代币合约。预算和退款使用同一种资产，网络手续费另计。
4. 在钱包确认操作。原生代币直接锁定预算；稳定币先授权，再锁定预算。资金确认后保存 Base URL、API Key 和模型名，完整 Key 只显示一次。
5. 在“调用实验室”或自己的 SDK 中发起调用，在“账单与结算”核对用量、费用和链上交易。
6. 不再使用时申请退回未用预算。待结算和用量核对完成后，使用原钱包提取可提现余额。

当前市场固定一种链和资产，没有自动换币或跨链操作。若需另一种结算资产，使用已开通对应资产的市场。

下面的 API 步骤面向自行集成的客户端。

## 1. 发现资源与登录

```bash
BASE_URL=http://localhost:3000
curl "$BASE_URL/api/v1/network"
curl "$BASE_URL/api/v1/resources?kind=gateway&limit=20"
```

资源价格以当前结算资产的整数百万分之一 / 百万 Token 表示。核对模型 ID 和输入、输出报价；模型身份由商家声明。

连接钱包并签名登录，或使用 [API 钱包认证](./API.md#钱包登录)。下列管理示例中的 `COOKIE_JAR` 是该消费者自己的登录 Cookie，不是商家 Cookie。

## 2. 锁定预算

网页可直接创建预算会话。外部客户端：

```bash
curl -b "$COOKIE_JAR" "$BASE_URL/api/v1/consumer/sessions" \
  -H 'Content-Type: application/json' \
  -d '{"listingId":"YOUR_RESOURCE_ID","budget":5000000}'
```

`5000000` 表示 5 单位当前结算资产；锁定金额由用户自行填写，支持小于 1 或大于 100 单位的金额。金额必须大于零，最多六位小数；REST 使用安全整数微单位。不同资产不做汇率换算。

钱包模式返回 `mode: "wallet"`、会话 `id` 和 `transaction` 条款，此时是 **DRAFT，不是已付款或已激活**。不要自动重复创建会话。

1. 读取 `/network`，核对链 ID、资产、代币精度、托管合约和 `ready`。原生代币的 token 为零地址。
2. 将整数预算乘以 `10 ** (tokenDecimals - 6)`，得到链上预算。USDT、USDC 先授权托管合约，原生代币直接附带 value。
3. 钱包调用 `openSession(id, provider, termsHash, chainBudget, expiresAt)`。原生资产使用 `nativeEscrowAbi` 并附带 `value: chainBudget`；稳定币使用 `escrowAbi`，不附带 value。其他参数逐项使用返回条款。
4. 等待回执，再确认开通：

```bash
curl -b "$COOKIE_JAR" "$BASE_URL/api/v1/consumer/sessions/$SESSION_ID/confirm" \
  -H 'Content-Type: application/json' \
  -d '{"txHash":"YOUR_OPEN_TRANSACTION_HASH"}'
```

也可发送 `{}`，由服务端查找开通事件。确认会核对消费者、提供者、预算、条款和确认数；首次返回 `ACTIVE` 时同时返回 `connection: {base_url, key, model}`，可直接复制到调用方。Key 与激活在同一事务中写入，平台仅保存哈希。重复确认不再发新 Key；若首次响应丢失，在密钥页撤销未知 Key，再按下节创建替代 Key。ABI 源文件为 [`src/lib/abi.ts`](../src/lib/abi.ts)，使用自己钱包对应的 viem 等客户端发送交易。

本地演示仅接受显式设置的回环链 31337。外部钱包按 `/network` 的链 ID、资产和托管合约操作。

## 3. 创建 Key

```bash
curl -b "$COOKIE_JAR" "$BASE_URL/api/v1/consumer/keys" \
  -H 'Content-Type: application/json' \
  -d '{"sessionId":"YOUR_SESSION_ID","name":"My application"}'
```

成功为 HTTP 201，返回 `{ "base_url": "https://your-platform.example/v1", "key": "t2a_…", "model": "YOUR_SESSION_MODEL" }`。完整 Key 仅此一次返回，保存在应用服务端。它只能使用该会话的模型和预算。用 `GET /consumer/keys` 查询元数据，用 `POST /consumer/keys/{id}/revoke` 和 `{}` 撤销。

## 4. 调用模型

```bash
curl -N "$BASE_URL/v1/chat/completions" \
  -H "Authorization: Bearer $TOKEN2API_KEY" \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: logical-request-0001' \
  -d '{"model":"YOUR_SESSION_MODEL","messages":[{"role":"user","content":"Hello"}],"max_tokens":512,"stream":true,"stream_options":{"include_usage":true}}'
```

每个新逻辑调用使用新的 `Idempotency-Key`，同一次调用重试复用原键。长度 8–128；重复键返回 409，不再派发或扣费。服务端不保存可重放的完整生成内容。

Node.js / TypeScript 的官方 OpenAI SDK 用法：

```ts
import { randomUUID } from "node:crypto";
import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.TOKEN2API_KEY,
  baseURL: "http://localhost:3000/v1",
  maxRetries: 0,
});
const requestKey = randomUUID(); // 保存到自己的业务请求记录中
const completion = await client.chat.completions.create(
  {
    model: "YOUR_SESSION_MODEL",
    messages: [{ role: "user", content: "Hello" }],
    max_tokens: 512,
  },
  { headers: { "Idempotency-Key": requestKey } },
);
console.log(completion.choices[0]?.message.content);
```

生产环境替换为自己的 HTTPS 应用地址。当前只支持纯文本 Chat Completions；未知参数会返回 400。`max_tokens` 为 128–2048，默认 512；最多 20 条消息，单条内容最多 8000 Unicode 码点，整个 messages 序列化 JSON 不超过 24000 UTF-8 字节。原始请求体不超过 160 KiB。

流式 HTTP 200 后仍可能收到 SSE `error`。收到 `[DONE]` 不会抵消此前的 error；不能只根据 HTTP 200 或 DONE 判为成功。使用 SDK 或完整 SSE 解析器处理数据帧，不要把网络分片当作完整事件。

## 5. 响应丢失与账单核对

响应丢失、超时或断流后，先用同一 Key 和原幂等键查询：

```bash
curl -G "$BASE_URL/api/v1/requests/lookup" \
  -H "Authorization: Bearer $TOKEN2API_KEY" \
  --data-urlencode "idempotency_key=$REQUEST_KEY"
```

接口返回请求状态、Token、费用和预留，不返回生成文本，也不再次调用上游。Key 撤销后改用钱包会话查询：

```bash
curl -G -b "$COOKIE_JAR" "$BASE_URL/api/v1/consumer/requests" \
  --data-urlencode "sessionId=$SESSION_ID" \
  --data-urlencode "idempotencyKey=$REQUEST_KEY"
```

- `RUNNING`：等待并继续查询。
- `COMPLETED`：费用已核销；再查结算批次确认链上状态。
- `REVIEW` 或 Token 为 `null`：用量待核对，保留预留，联系运营者；不能当成零消费。
- 404／空列表：不能据此认定在途调用从未受理。先排除竞态、会话与 Key 不匹配；核对完成前不要用新键重新付费调用。

REST 流断开后服务端会继续收集上游用量。客户端断开并不等于请求取消或免费。

## 6. 结算、关闭与退款

```bash
curl -b "$COOKIE_JAR" "$BASE_URL/api/v1/consumer/sessions/$SESSION_ID"
curl -b "$COOKIE_JAR" "$BASE_URL/api/v1/consumer/settlements?sessionId=$SESSION_ID"

curl -b "$COOKIE_JAR" "$BASE_URL/api/v1/consumer/sessions/$SESSION_ID/settle" \
  -H 'Content-Type: application/json' -d '{}'

curl -b "$COOKIE_JAR" "$BASE_URL/api/v1/consumer/sessions/$SESSION_ID/close" \
  -H 'Content-Type: application/json' -d '{}'
```

worker 会自动处理结算；手工触发仍复用持久化结算任务。会话 `availableBudget = budget - spent - reserved`；先预留，再按 usage 核销，不会因为用量未知而显示成全部预算可用。

关闭遇到 `409 pending_requests` 时，服务端已停止新接单；须等待执行中请求或人工核对完成后重试。关闭后未用预算进入链上 **可提现余额**，不会由此 REST 自动转入钱包。网页提取余额或由自己的钱包调用 escrow 的 `withdraw()`。

原生币市场的网页提现可以填写收款地址，默认使用当前钱包地址。不能直接接收原生币转账的合约钱包，可由该钱包调用 `withdrawTo(recipient)`，将自己的全部可提现余额转入同一网络上可收款的地址。只有原钱包可以发起提现；收款地址不会获得代提现权限。收款地址不能为零地址，转账失败会回滚，原可提现余额保持不变。ERC20 市场仍提取到当前钱包。

`withdrawTo` 需要部署包含此入口的新版原生币托管合约。已经部署的合约不会因源码更新而改变。按部署规则，新合约使用独立账本；原合约中的余额和会话须在原合约处理，不能直接改绑数据库。

长期平台故障时，消费者可直接在合约 `requestClose(id)`，等待 120 秒退出窗口后 `closeSession(id)`，再 `withdraw()`。请按部署 ABI 与当前链上状态操作。链上正常退出不能代替对未核对用量的运营处理。


## 申请退回未使用额度

网页“账单与结算 → 预算会话 → 申请退款”会显示当前可退额度，确认后停止新调用。对应钱包 Cookie 管理接口为 `POST /api/v1/consumer/sessions/{id}/refund`，JSON body 为 `{}`；使用 `GET` 同一路径读取状态。申请在账本留痕，重复申请不会重复记账或退款。

`PROCESSING` 表示结算中，`PENDING_REVIEW` 表示仍有待核对用量与预留。`AVAILABLE` 表示合约已确认关闭，未用预算进入原消费者的可提现余额。原钱包调用 `withdraw` 提取全部可提现资产；已消费用量与 Gas 不在退款范围内。
