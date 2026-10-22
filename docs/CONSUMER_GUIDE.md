# 下游使用指南

创建 API Key，选择允许使用的模型，再向统一预付账户充值。调用时指定平台模型 ID，上游由平台选择，按平台统一模型报价计费。所有模型 Key 共用当前钱包的预付余额，不需要选择供应商或创建预算会话。

每套部署固定一条链、一种结算资产和一个托管合约，不自动换币或跨链。先读取 `/api/v1/network` 的 `chainId`、`asset`、`tokenDecimals`、`ledgerUnit` 和 `balanceUnit`。金额使用结算资产的整数百万分之一，价格单位是当前资产 / 百万 Token，换算见[多链结算](./MULTICHAIN.md)。

## 网页使用

1. 在控制台核对网络、结算资产与 Gas 币种，连接钱包并签名登录。登录签名不授权转账。
2. 在“模型市场”搜索模型，按可用状态筛选、按输入或输出价格排序。这里显示平台统一报价，平台模型 ID 可以与上游 ID 不同。
3. 点击“创建模型 Key”，填写名称并勾选允许使用的模型。也可在“API 密钥”创建。每个 Key 明确授权 1–100 个模型，平台新增模型不会自动授权。
4. 保存仅显示一次的完整 Key 与 Base URL。列表只显示脱敏元数据。可以编辑模型权限或撤销 Key；撤销不取消已经派发的调用。
5. 在“API 密钥”或“账单与结算”的预付账户中充值。原生币直接支付充值金额；稳定币依次重置授权、设置本次授权、充值。每次交易由钱包签名，Gas 另计。
6. 在调用实验室选择 Key 与已授权模型，或通过 SDK 调用。界面等待完整响应，不提供停止按钮。失败后先查账单和原幂等请求，避免重复付费调用。
7. 在账单核对用量、用户费用、预留和链上结算。未用调用预留由 worker 退回预付账户。只有可用余额可提取，提取由钱包签名。

加载、空数据、错误、提交中和成功分别显示。手机端可完成 Key 创建、授权、充值表单与调用；宽表格可横向滚动。弹窗支持 Tab、Shift+Tab 和 Escape，关闭后归还焦点。提交失败保留输入；切换钱包会清除当前身份的私密状态。

## API 创建 Key 与授权

先按 [API 钱包登录](./API.md#钱包登录) 获取 Cookie。以下 `BASE_URL` 为平台地址，`COOKIE_JAR` 为私密登录文件。

```bash
curl "$BASE_URL/api/v1/catalog/models"

curl -b "$COOKIE_JAR" "$BASE_URL/api/v1/consumer/keys" \
  -H 'Content-Type: application/json' \
  -d '{"name":"My app","models":["platform-model-id"]}'
```

创建成功返回 HTTP 201，包含 `base_url`、完整 `key`、已授权 `models` 和一个供示例使用的 `model`。调用时可选 `models` 中任意仍启用的模型。完整 Key 不再提供重读；遗失后创建新 Key 并撤销旧 Key。

```bash
curl -b "$COOKIE_JAR" "$BASE_URL/api/v1/consumer/keys?limit=20"

curl -b "$COOKIE_JAR" "$BASE_URL/api/v1/consumer/keys/$KEY_ID/models" \
  -H 'Content-Type: application/json' \
  -d '{"models":["platform-model-id","another-model-id"]}'

curl -b "$COOKIE_JAR" "$BASE_URL/api/v1/consumer/keys/$KEY_ID/revoke" \
  -H 'Content-Type: application/json' -d '{}'
```

Cookie 管理接口拒绝推理 Bearer Key。模型权限在请求受理和执行准入时复查，不能用另一个钱包管理 Key。

## 充值与提取

```bash
curl -b "$COOKIE_JAR" "$BASE_URL/api/v1/consumer/prepaid"

curl -b "$COOKIE_JAR" "$BASE_URL/api/v1/consumer/prepaid/transactions" \
  -H 'Content-Type: application/json' \
  -d '{"kind":"deposit","amount":1000000}'
```

`amount: 1000000` 表示 1 单位当前结算资产。响应只是交易计划，包含 `chainId`、账本 `amount` 和依次发送的 `transactions`（`to`、`data`、原始链上 `value`）。必须核对网络、目标、方法、金额和授权接收方，再由原钱包逐笔签名发送。Web 内部继续使用 tRPC，不直接调用这些管理 REST。

提取使用 `{"kind":"withdraw","amount":1000000}`。只能提取已确认且未预留的余额，不能取走运行中或 REVIEW 占用的资金。链上权限和余额检查仍会执行，过期计划可能失败，不能自动扩大授权或换钱包重试。

预付账户返回：

- `balance`：保守确认的空闲链上余额，原始整数单位按 `/network` 的 `balanceUnit` 和 `tokenDecimals` 解释。
- `available`：扣除尚在准备的预留后可用于新调用或提取的余额，使用 `ledgerUnit`。
- `preparing`：正在准备的逐次预算；`reserved`：执行中或待核对用量的预留。
- `pendingSettlement`：已确认用量、尚待链上结算的费用；`releasing`：内部预算中尚未核销、待关闭退回的部分。

这些状态可能短暂重叠，不能相加当作账户总资产。充值需等待确认，已发生的提取立即限制新准入。旧合约不支持预付账户或 RPC 不可用时返回 503，界面不会把错误显示为零余额。

## 调用模型

```bash
curl "$BASE_URL/v1/models" -H "Authorization: Bearer $TOKEN2API_KEY"

curl "$BASE_URL/v1/chat/completions" \
  -H "Authorization: Bearer $TOKEN2API_KEY" \
  -H 'Content-Type: application/json' \
  -H "Idempotency-Key: $REQUEST_KEY" \
  -d '{"model":"platform-model-id","messages":[{"role":"user","content":"Hello"}],"max_tokens":512}'
```

`GET /models` 仅返回该 Key 已授权且平台仍启用的模型。支持 OpenAI 文本 Chat Completions 的普通响应及真实 SSE，SDK 设置 `maxRetries: 0`。每个新调用使用新的 `Idempotency-Key`（8–128 字符）；同一次调用重试复用原值，Key 级幂等范围跨模型和上游。重复受理返回 409，不再次执行。

每次调用先固定可用上游和两份报价，再从预付余额确认最大费用预留，之后才执行推理。因此开始输出前包含真实的链上准备时间。平台选择已上架、在线、有并发且报价不高于用户报价的路由；不保证固定供应商。受理后不会因失败切换上游重放请求。

JSON 响应的 `token2api.cost` 使用 `token2api.unit`。提示词限文本、最多 20 条，序列化后最多 24000 UTF-8 字节；输出上限 128–2048 Token。SSE 出错可在 HTTP 200 后返回错误帧。客户端断开不证明上游停止或免费。

## 核账与 REVIEW

```bash
curl "$BASE_URL/api/v1/requests/lookup?idempotency_key=$REQUEST_KEY" \
  -H "Authorization: Bearer $TOKEN2API_KEY"

curl -b "$COOKIE_JAR" "$BASE_URL/api/v1/consumer/requests?limit=20"
curl -b "$COOKIE_JAR" "$BASE_URL/api/v1/consumer/settlements?limit=20"
```

预留尚未生成上游账单时，lookup 返回 `409 request_preparing`。这不是允许换幂等键重发的证明。若预留已被确认取消或释放且没有上游执行记录，返回 `409 request_not_executed`；本次幂等键仍不会重新执行。不存在返回 404，也须先排除钱包、Key 和请求标识错误。已撤销 Key 不再允许查询，原钱包仍可用 Cookie 核账。

`RUNNING` 表示执行中；`COMPLETED` 表示用量已核销，仍须核对结算状态。`REVIEW` 或未知 Token 为 `null` 时保留预留，费用不按零处理。只有确认链上结算的批次可显示 `CONFIRMED`。`providerCost` 为供应商费用（未扣服务费），与调用者支付的 `cost` 分开。

结算 worker 恢复持久化的资金任务，不重新执行推理。未知用量由运营者依据上游账单或审计证据处理，不自动推断零用量。详见[模型路由说明](./MODEL_ROUTING.md)。

## 原有预算会话兼容

会话接口的 `fundingSource` 区分 `WALLET`（原钱包预算）与 `PREPAID`（平台自动建立的预付调用预留）。不能为内部预付预留创建旧式单会话 Key；使用原模型 Key 的模型权限。

原有会话仍固定一位商家、一份资源和一份价格快照，不切换资金来源或报价。保留 `/consumer/sessions` 的创建、详情、确认、结算、关闭和退款接口；旧客户端也可继续用 `{"name":"Legacy app","sessionId":"会话 ID"}` 创建单会话 Key。

`POST /consumer/sessions/{id}/refund` 使用 `{}` 申请退款，`GET` 查询。`PROCESSING` 为处理中，`PENDING_REVIEW` 继续保留预留。`AVAILABLE` 表示链上关闭已确认。原有钱包预算的退款进入 `claimable`，需由原钱包调用 `withdraw()`；新预付租约的退款返回统一预付账户，响应 `destination: "prepaid"` 且 `withdrawRequired: false`。不能把两类余额合并或直接转换。

原生币旧会话的可提现余额支持原钱包调用 `withdrawTo(recipient)`。预付余额提取使用 `withdrawPrepaid(amount)`，返回原钱包，不借用旧会话提现入口。

平台长期故障时，消费者可直接调用合约 `requestClose(id)`，等待退出窗口，再调用 `closeSession(id)`。预付租约的未用预算退回预付余额，原钱包预算则退回可提现余额；分别通过对应入口提取。按实际部署 ABI 和链上状态操作，链上退出不能代替未知用量的运营核对。
