> 新部署按 MON / 百万 Token 报价。API 价格为整数 microMON，1 MON = 1,000,000 microMON。商家收入、退款余额及提现原生 MON 使用 wei 字符串；按接口 unit 读取，不要按 microMON 解释原始余额。旧 dUSD 部署保持原单位并隔离运行。

# 商家使用指南

商家提供 AI 网关，mon2api 负责挂牌、消费预算、计量与分账。商家自己的上游系统负责账号授权、凭证刷新、账号调度、额度与执行隔离。平台管理后台和完整号池后台不在本指南范围内。

## 1. 准备并登录

- 准备已授权的、可访问的文本 Chat Completions 网关。
- 验证模型准确 ID、流式输出和最终 usage；只使用模型调用 Key，不上传账号密码或上游管理 Key。
- 请运营者把网关 origin 加入 `UPSTREAM_ALLOWED_ORIGINS`。正式远程网关使用 HTTPS。
- 在控制台连接钱包并签名登录，进入“我的号池”；也可按 [API 钱包认证](./API.md#钱包登录) 获取 Cookie。

以下 curl 示例假定 `BASE_URL` 是应用地址、`COOKIE_JAR` 是已保存商家登录 Cookie 的私密文件：

```bash
BASE_URL=http://localhost:3000
```

## 2. 挂牌

网页使用“接入资源”。REST 使用：

```bash
curl -b "$COOKIE_JAR" "$BASE_URL/api/v1/merchant/resources" \
  -H 'Content-Type: application/json' \
  --data-binary @resource.json
```

`resource.json` 示例；真实调用 Key 只保存在私密配置中，不提交文件：

```json
{
  "name": "My text gateway",
  "description": "授权的文本推理资源",
  "kind": "gateway",
  "connectionMode": "api",
  "model": "your-provider-model-id",
  "baseUrl": "https://gateway.example.com/v1",
  "apiKey": "YOUR_CALL_ONLY_UPSTREAM_KEY",
  "inputRate": 2000000,
  "outputRate": 10000000,
  "concurrency": 2
}
```

返回 HTTP 201 与 `{ "id": "资源 ID" }`。示例 origin 必须替换并先加入允许清单。`baseUrl` 使用根地址或 `/v1`，不填完整 `/chat/completions`。报价表示输入 2 dUSD、输出 10 dUSD / 百万 Token；并发范围 1–20。

`connectionMode` 默认 `api`。连接商家自己的 OAuth 号池网关时使用 `oauth_pool`，并提交该网关签发、绑定号池的专用推理 Key。OAuth 授权、凭证刷新与账号调度仍由商家的号池网关完成；该字段只是商家声明，不代表平台已验证账号授权。查询资源时可用 `connectionMode=api` 或 `connectionMode=oauth_pool` 筛选。

模型名与报价是商家声明，不代表平台已核验模型身份或官方折扣。上游凭证会加密存储；所有资源查询都不返回它。

## 3. 查询、改价与暂停

```bash
curl -b "$COOKIE_JAR" "$BASE_URL/api/v1/merchant/resources?limit=20"

curl -b "$COOKIE_JAR" "$BASE_URL/api/v1/merchant/resources/$RESOURCE_ID" \
  -H 'Content-Type: application/json' \
  -d '{"inputRate":2500000,"outputRate":12000000,"concurrency":3}'

curl -b "$COOKIE_JAR" "$BASE_URL/api/v1/merchant/resources/$RESOURCE_ID/status" \
  -H 'Content-Type: application/json' \
  -d '{"enabled":false}'
```

更新至少包含一个字段。可修改 `name`、`description`、`inputRate`、`outputRate`、`concurrency`。改价只影响新建会话，已有会话继续使用原价格快照。

暂停后该资源不再出现在公开发现接口中，也停止已有会话的新请求；已派发请求仍可能产生费用。暂停不等于关闭消费者会话或退回预算。

模型、资源类型、连接模式和连接器绑定不可修改。更换上游地址或 Key 时暂停旧资源并新建资源，核对已有会话结算。不能把旧会话静默迁移到另一套上游。

## 4. 核账与提现

```bash
curl -b "$COOKIE_JAR" "$BASE_URL/api/v1/merchant/requests?limit=20"
curl -b "$COOKIE_JAR" "$BASE_URL/api/v1/merchant/settlements?limit=20"
curl -b "$COOKIE_JAR" "$BASE_URL/api/v1/account/balances"
```

账单与结算仅返回当前钱包作为提供者的记录。按 `sessionId` 过滤单个会话，按 `nextCursor` 翻页。

- `REVIEW`：用量未确定，保留预留；提供上游请求 ID 和审计记录，由运营者核对。
- `READY`：结算尚未确认，不能视为到账。
- `CONFIRMED`：链上已确认。结算 `amount` 是消费增量总额，不能直接视为商家净收入；平台费按合约累计金额计算。
- `UNCOLLECTIBLE`：确认链上退出后无法收回的费用，不能算作商家已到账收入。

`claimable` 是当前钱包链上的可提现余额；钱包同时消费时也可能包含退款。网页“提取余额”由钱包确认交易。外部客户端读取 `/network` 的 escrow 地址，在其 RPC 上由自己的钱包调用 `withdraw()`；该操作不由推理 Key 或 REST 自动代签。

## 5. 上线前验收

先完成一条真实上游调用，并同时核对最终 usage、上游请求 ID、消费者费用、链上分账与退款。随后验证 429、失效凭证、断流和缺失 usage。模拟响应及本地测试币不能代替这一步。协议细节和故障处理见 [POOL.md](./POOL.md)。
