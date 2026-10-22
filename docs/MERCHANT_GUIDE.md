> 按当前部署资产 / 百万 Token 报价。整数账本单位为 `micro_<asset>`；余额按 `/network` 的 `tokenDecimals` 和余额接口的 `unit` 读取。详见[多链结算](./MULTICHAIN.md)。

# 商家使用指南

商家提供 AI 网关，Token2API 负责挂牌、消费预算、计量与分账。商家自己的上游系统负责账号授权、凭证刷新、账号调度、额度与执行隔离。运营者接入审核见[管理后台](./ADMIN_GUIDE.md)。

## 网页使用

1. 在控制台“当前市场”核对结算资产。输入、输出报价和最终收入都使用该资产；网络手续费使用本链原生代币。
2. 连接钱包并签名登录，进入“我的资源”，点击“接入资源”。
3. 选择本机连接器或平台直连，读取网关声明的模型列表，再选模型并按当前资产设置报价。
4. 上架后保持网关可用。在“我的资源”按名称、模型和上架状态查询，列表支持分页。通过“用量与收入账单”进入“账单与结算”核对已确认用量和结算交易。收入进入当前市场的可提现余额，再由原钱包提取。

“我的资源”的关联调用只统计当前返回记录中，当前钱包作为商家的会话调用。可提现余额来自链上余额接口，可能同时包含商家收入和调用退款，不表示独立商家净收入。

相同数字的 ETH、BNB、POL、AVAX 与稳定币报价代表不同价格，不会自动换算。切换到另一资产的市场时需重新确定报价。

## 1. 准备并登录

- 准备已授权的、可访问的文本 Chat Completions 网关。
- 验证模型准确 ID、流式输出和最终 usage；只使用模型调用 Key，不上传账号密码或上游管理 Key。
- 平台直连需请管理员把完整 API 基础地址加入后台白名单。正式远程网关使用 HTTPS。需要代理时，还须单独批准代理地址。
- 在控制台连接钱包并签名登录，进入“我的资源”；也可按 [API 钱包认证](./API.md#钱包登录) 获取 Cookie。

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
  "model": "your-provider-model-id",
  "baseUrl": "https://gateway.example.com/v1",
  "apiKey": "YOUR_CALL_ONLY_UPSTREAM_KEY",
  "inputRate": 2000000,
  "outputRate": 10000000,
  "concurrency": 2
}
```

返回 HTTP 201 与 `{ "id": "资源 ID" }`。示例完整基础地址必须替换并先加入白名单。`baseUrl` 可包含自定义 API 基础路径，如 `/proxy/openai`；根地址默认使用 `/v1`。不填完整 `/chat/completions`。报价表示输入 2、输出 10 单位当前结算资产 / 百万 Token；并发范围 1–20。

平台直连可在同一 JSON 中添加可选字段 `proxy`，模型发现接口也接受相同配置：

```json
{
  "proxy": {
    "url": "https://proxy.example.com:8080",
    "username": "YOUR_PROXY_USERNAME",
    "password": "YOUR_PROXY_PASSWORD"
  }
}
```

无需认证时省略 `username` 和 `password`；无需代理时省略整个 `proxy`。代理 URL 不包含路径或凭证，支持 HTTP/HTTPS，必须由平台服务器可达。带认证的远程代理须使用 HTTPS，HTTP 认证仅允许回环地址；已有不安全配置也会被运行时拦截，须重新接入。认证信息加密保存，不向调用者或资源查询接口返回。代理失败不会自动改为直连或重发推理。代理和网关为资源固定配置，变更时暂停旧资源并重新接入。本机连接器不接受平台直连代理字段，其网络由商家机器管理。

商家统一以网关地址和模型调用 API Key 接入。平台使用钱包签名登录，不提供第三方账号登录或授权，不接收账号 access token、refresh token 或网关管理密钥。

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
