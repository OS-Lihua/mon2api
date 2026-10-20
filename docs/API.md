# Token2API API 使用说明

商家和下游管理接口统一使用 `/api/v1`。推理接口额外兼容 `/v1/models` 与 `/v1/chat/completions`。管理接口没有 `/v1` 别名。完整请求、响应及约束见运行服务的 [`/api/v1/openapi.json`](http://localhost:3000/api/v1/openapi.json)。

- [商家接入与资源管理](./MERCHANT_GUIDE.md)
- [下游购买、调用与核账](./CONSUMER_GUIDE.md)
- [网关协议与部署边界](./POOL.md)

## 认证与权限

| 凭证 | 用途 | 获取方式 |
| --- | --- | --- |
| `token2api_session` Cookie | 商家、消费者管理操作与私有账单 | 钱包签署 SIWE 登录消息；8 小时有效 |
| `Authorization: Bearer t2a_…` | 模型查询、推理、按幂等键查询该会话的用量 | 为自己的活跃预算会话创建 Key；完整值仅返回一次 |

管理接口拒绝 `Authorization` 头，即使同时携带有效 Cookie。推理 Key 不能上架资源、创建预算、创建其他 Key 或读取其他会话。

没有单独的商家注册角色。同一个钱包可提供资源，也可购买资源。所有权由服务端钱包身份确定；请求体不能指定 `owner`、`consumer` 或 `provider`。查询不属于当前钱包的对象返回 404。

### 钱包登录

1. `POST /auth/challenge`，JSON 为 `{"address":"钱包地址"}`。返回 `{ "message": "完整 SIWE 消息" }`，有效期 5 分钟。
2. 钱包签署返回的原始消息，不改域名、链 ID 或文字。
3. `POST /auth/login`，JSON 包含 `address`、`message`、`signature`。成功后设置 HttpOnly Cookie，返回当前钱包信息。
4. 后续请求携带该 Cookie。`GET /auth/me` 核对身份，`POST /auth/logout` 携带 `{}` 退出。

浏览器在应用自身域名下调用。示例中的 `walletClient` 是当前连接的钱包的 viem 客户端：

```js
async function post(path, body) {
  const response = await fetch(`/api/v1${path}`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(`${response.status}: ${result.error.code}`);
  return result;
}

const [address] = await walletClient.getAddresses();
if (!address) throw new Error("请先连接钱包");
const { message } = await post("/auth/challenge", { address });
const signature = await walletClient.signMessage({ account: address, message });
const me = await post("/auth/login", { address, message, signature });
```

服务端验证签名、配置链、原始域名和一次性 nonce。登录签名不授权代币转账。链上锁预算和提现需要另签交易。

CLI/服务端客户端用自己的钱包签名器完成同一流程，并保存 `/auth/login` 返回的 `Set-Cookie`。curl 后续使用 `-b "$COOKIE_JAR"`，登录时使用 `-c "$COOKIE_JAR"`。不要把 Cookie Jar 或完整 Key 提交到仓库。可运行的本地签名和 Cookie 示例见 [`scripts/api-smoke.ts`](../scripts/api-smoke.ts)。该脚本只接受回环链 31337，不能用其公开测试身份连接真实网络。

所有浏览器管理 POST 的 `Origin` 必须等于 `APP_ORIGIN`。无 `Origin` 的 CLI 请求仍须有效签名会话。`ALLOWED_ORIGINS` 只控制共享 REST CORS 响应，不扩大管理写入的来源权限。网页内部继续使用 tRPC，共享相同领域服务。

## 接口目录

以下路径均相对 `/api/v1`。所有 POST 都发送 JSON；无参数的操作发送 `{}`。

| 方法与路径 | 凭证 | 功能 |
| --- | --- | --- |
| `GET /network` | 无 | 当前链、公开合约地址、费率和就绪状态 |
| `GET /resources` | 无 | 分页查询已上架资源，支持 `q`、`kind` |
| `GET /resources/{id}` | 无 | 已上架资源详情，不含连接器地址或凭证 |
| `POST /auth/challenge`、`POST /auth/login` | 钱包签名 | 登录 |
| `GET /auth/me`、`POST /auth/logout` | Cookie／退出无强制登录 | 当前身份／退出 |
| `GET /account/balances` | Cookie | 当前钱包代币余额与可提现余额 |
| `GET /merchant/resources` | Cookie | 自己的资源，包含暂停资源；支持 `q`、`kind` |
| `POST /merchant/resources` | Cookie | 创建资源；成功为 201 |
| `GET /merchant/resources/{id}` | Cookie | 自己的资源详情 |
| `POST /merchant/resources/{id}` | Cookie | 修改名称、描述、报价或并发 |
| `POST /merchant/resources/{id}/status` | Cookie | 设置 `enabled` |
| `GET /merchant/requests` | Cookie | 自己作为提供者的调用账单 |
| `GET /merchant/settlements` | Cookie | 自己作为提供者的结算批次 |
| `GET /consumer/sessions` | Cookie | 自己购买的预算会话 |
| `POST /consumer/sessions` | Cookie | 准备预算会话；成功为 201 |
| `GET /consumer/sessions/{id}` | Cookie | 自己的会话、价格快照与剩余预算 |
| `POST /consumer/sessions/{id}/confirm` | Cookie | 核对链上开通并激活 |
| `POST /consumer/sessions/{id}/settle` | Cookie | 触发已有消费的结算 |
| `POST /consumer/sessions/{id}/close` | Cookie | 停止接单，完成结算后关闭 |
| `GET /consumer/keys`、`POST /consumer/keys` | Cookie | 查询 Key 元数据／创建 Key（201） |
| `POST /consumer/keys/{id}/revoke` | Cookie | 撤销自己的 Key |
| `GET /consumer/requests` | Cookie | 自己的调用账单；支持 `sessionId`、`idempotencyKey` |
| `GET /consumer/settlements` | Cookie | 自己的结算批次 |
| `GET /models` | 推理 Key | Key 绑定的模型名称 |
| `POST /chat/completions` | 推理 Key | 文本普通／流式调用 |
| `GET /requests/lookup?idempotency_key=…` | 推理 Key | 查询该 Key 会话的请求状态与用量 |

`merchant/requests`、两端的 `settlements` 和 `consumer/keys` 支持 `sessionId` 过滤。商家读接口不返回消费者 Key 或提示词。

## 金额与状态

金额、预算和报价都是当前结算资产的整数百万分之一。`inputRate: 2000000` 表示输入每百万 Token 为 2 单位该资产。账本单位为 `micro_<asset>`，不可传小数或未经换算的其他资产价格。创建预算不设业务额度上下限；`budget` 必须为正安全整数微单位（最大 9,007,199,254,740,991），支持小于 1 或大于 100 单位资产的金额。

`GET /network` 返回 `chainId`、`asset`、`tokenDecimals` 和单位。链上金额等于账本金额乘以 `10 ** (tokenDecimals - 6)`。`GET /account/balances` 返回原始整数余额字符串，原生资产的 `unit` 为 `wei`，USDT、USDC 为 `atomic`。RPC 失败返回 503，不返回零余额。各实例账本独立，部署细节见[多链结算](./MULTICHAIN.md)。

| 对象 | 关键状态 |
| --- | --- |
| 会话 | `DRAFT` 待链上确认；`ACTIVE` 可接单；`CLOSING` 停止新请求；`CLOSED` 已关闭 |
| 调用 | `RUNNING` 处理中；`COMPLETED` 已核销用量；`REVIEW` 待核对；`FAILED` 失败 |
| 结算 | `READY` 待确认；`CONFIRMED` 已确认；`UNCOLLECTIBLE` 无法收回 |

请求的 `inputTokens`、`outputTokens` 可以为 `null`。这表示未知，不是零。`REVIEW` 保留 `reservation`，不能自动释放或重复发起付费请求。`COMPLETED` 也不等于已链上结算，应核对结算记录。

## 分页与响应

列表参数：`limit` 默认 20，范围 1–100；下一页原样传上一页的 `nextCursor`。按 `createdAt`、`id` 倒序排列。未知参数、重复参数和非法范围返回 400。

```json
{
  "data": [],
  "hasMore": false,
  "nextCursor": null
}
```

分页是实时视图，新增或更新可能改变后续页；不是总账快照。不要把一页结果当完整历史统计。所有这些 REST 响应均设 `Cache-Control: no-store`。

错误格式：

```json
{
  "error": {
    "code": "not_found",
    "message": "会话不存在。"
  }
}
```

| HTTP | 处理方式 |
| --- | --- |
| 400 | 检查 JSON、字段、ID 和查询参数 |
| 401 | Cookie/Key 无效、过期或凭证类型用错 |
| 402 | 可用预算不足以预留本次最大费用 |
| 403 | 来源不匹配、演示模式未启用等限制 |
| 404 | 不存在、未上架或不属于当前身份 |
| 408 / 413 | 请求体读取超过 10 秒／160 KiB |
| 409 | 幂等冲突、待核对、链上未确认或状态冲突；先查状态 |
| 429 | 限流或资源并发已满；未受理时才可按原键重试 |
| 500 / 503 | 服务或链暂不可用；先核对操作是否已受理 |

不要自动重试创建资源、预算会话或 Key：这些管理创建操作没有请求去重承诺。消费结算继续由持久化 outbox、nonce 和链上回执恢复，不通过客户端生成新请求绕过冲突。

## 验证

```bash
pnpm verify
pnpm test:api
```

`test:api` 需要本地服务、数据库与链已启动，服务端显式设置 `TOKEN2API_MODE=local` 和 `ALLOW_DEMO=true`。默认访问 `http://localhost:3000`；测试其他本地端口可用 `pnpm test:api --origin http://localhost:3001`，对应服务端的 `APP_ORIGIN` 必须一致。脚本只允许 HTTP 回环地址和链 31337。

测试使用两位公开测试钱包做真实 REST 登录、商家资源读写、越权拒绝、分页、账单契约和 OpenAPI 检查。测试资源结束时被暂停并保留记录；不会调用真实模型或发送资金交易。链上资金闭环另用 `pnpm test:e2e`，故障恢复用 `pnpm test:recovery`。这些本地检查不代替外部网关或测试网钱包验收。
