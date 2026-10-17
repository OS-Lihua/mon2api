> 新部署使用 Monad 测试网原生 MON。账本和报价使用整数 microMON（1 MON = 1,000,000 microMON），原生转账使用 wei（1 microMON = 10^12 wei）。读取 `/network` 的 `asset`、`ledgerUnit`、`balanceUnit`；余额字符串保持完整 18 位精度。旧 dUSD 部署只维护已有会话，须使用独立数据库。

# 下游使用指南

下游使用者先选择资源、锁定预算，再用独立 Key 调用模型。一个预算会话固定一位商家、一份资源和一份价格快照，不自动切换商家或模型。

## 1. 发现资源与登录

```bash
BASE_URL=http://localhost:3000
curl "$BASE_URL/api/v1/network"
curl "$BASE_URL/api/v1/resources?kind=gateway&limit=20"
```

资源价格以 microMON / 百万 Token 表示。核对 `kind`、模型 ID、输入与输出报价。`demo` 为模拟资源，不产生真实模型响应；`gateway` 的模型身份仍由商家声明。

连接钱包并签名登录，或使用 [API 钱包认证](./API.md#钱包登录)。下列管理示例中的 `COOKIE_JAR` 是该消费者自己的登录 Cookie，不是商家 Cookie。

## 2. 锁定预算

网页可直接创建预算会话。外部客户端：

```bash
curl -b "$COOKIE_JAR" "$BASE_URL/api/v1/consumer/sessions" \
  -H 'Content-Type: application/json' \
  -d '{"listingId":"YOUR_RESOURCE_ID","budget":5000000}'
```

`5000000` 表示 5 MON；当前预算范围 1–100 MON。

钱包模式返回 `mode: "wallet"`、会话 `id` 和 `transaction` 条款，此时是 **DRAFT，不是已付款或已激活**。不要自动重复创建会话。

1. 读取 `/network`，核对 chainId=10143、asset=MON、escrow 及 `ready`。原生 MON 的 token 为零地址。
2. 将返回的整数 microMON 预算乘以 `10^12`，得到 `budgetWei`。不需要 ERC20 approve。
3. 钱包调用 nativeEscrowAbi 的 `openSession(id, provider, termsHash, budgetWei, expiresAt)`，同时附带 `value: budgetWei`；其他参数逐项使用返回条款。
4. 等待回执，再确认开通：

```bash
curl -b "$COOKIE_JAR" "$BASE_URL/api/v1/consumer/sessions/$SESSION_ID/confirm" \
  -H 'Content-Type: application/json' \
  -d '{"txHash":"YOUR_OPEN_TRANSACTION_HASH"}'
```

也可发送 `{}`，由服务端查找开通事件。确认会核对消费者、提供者、预算、条款和确认数；首次返回 `ACTIVE` 时同时返回 `connection: {base_url, key, model}`，可直接复制到调用方。Key 与激活在同一事务中写入，平台仅保存哈希。重复确认不再发新 Key；若首次响应丢失，在密钥页撤销未知 Key，再按下节创建替代 Key。ABI 源文件为 [`src/lib/abi.ts`](../src/lib/abi.ts)，使用自己钱包对应的 viem 等客户端发送交易。

本地 `demo` 登录模式只供测试脚本，会自动提交回环链交易。真实钱包登录会话的 `demo` 为 false；这不改变所选资源的 `kind`。默认目标网络为 Monad 测试网 chain 10143；本地测试须显式设置 `MON2API_MODE=local`，使用回环链 31337。以 `/network` 的部署地址和 `ready` 为准，浏览器界面不代表链上部署已经完成。

## 3. 创建 Key

```bash
curl -b "$COOKIE_JAR" "$BASE_URL/api/v1/consumer/keys" \
  -H 'Content-Type: application/json' \
  -d '{"sessionId":"YOUR_SESSION_ID","name":"My application"}'
```

成功为 HTTP 201，返回 `{ "base_url": "https://your-platform.example/v1", "key": "m2a_…", "model": "YOUR_SESSION_MODEL" }`。完整 Key 仅此一次返回，保存在应用服务端。它只能使用该会话的模型和预算。用 `GET /consumer/keys` 查询元数据，用 `POST /consumer/keys/{id}/revoke` 和 `{}` 撤销。

## 4. 调用模型

```bash
curl -N "$BASE_URL/v1/chat/completions" \
  -H "Authorization: Bearer $MON2API_KEY" \
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
  apiKey: process.env.MON2API_KEY,
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
  -H "Authorization: Bearer $MON2API_KEY" \
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

长期平台故障时，消费者可直接在合约 `requestClose(id)`，等待 120 秒退出窗口后 `closeSession(id)`，再 `withdraw()`。请按部署 ABI 与当前链上状态操作。链上正常退出不能代替对未核对用量的运营处理。


## 申请退回未使用额度

网页“账单结算 → 预算会话 → 申请退款”会显示当前可退额度，确认后停止新调用。对应钱包 Cookie 管理接口为 `POST /api/v1/consumer/sessions/{id}/refund`，JSON body 为 `{}`；使用 `GET` 同一路径读取状态。申请在账本留痕，重复申请不会重复记账或退款。

`PROCESSING` 表示结算中，`PENDING_REVIEW` 表示有待核对用量；两种状态下 amount 是当前未占用额度，reserved 继续保留，不能当作已到账退款。后台在核对完成后继续关闭会话。`AVAILABLE` 表示合约已确认关闭，amount 是该会话释放的退款（整数 microMON），进入消费者的可提现余额。点击“提取可提现 MON 到钱包”，由原钱包签名调用 withdraw；该次操作会提取该钱包的全部可提现余额，可能包含其他退款或收益。已消费用量与网络 Gas 不在未用额度退款范围内。
