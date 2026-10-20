# 多链结算

Token2API 是 AI 资源市场和多链结算平台。支持以下 EVM 主网，结算资产包括各链原生代币及已配置的 USDT、USDC 合约。实际开通情况以当前市场配置为准：

| 链 | Chain ID | 原生结算资产 / Gas |
| --- | --- | --- |
| Ethereum 主网 | 1 | ETH |
| Base | 8453 | ETH |
| Arbitrum One | 42161 | ETH |
| Optimism | 10 | ETH |
| BNB Smart Chain（BSC） | 56 | BNB |
| Polygon PoS | 137 | POL |
| Avalanche C-Chain | 43114 | AVAX |
| Robinhood Chain | 4663 | ETH |

钱包和服务端使用同一链目录，拒绝未支持的链 ID。Robinhood 参数来自[官方连接文档](https://docs.robinhood.com/chain/add-network-to-wallet/)。Solana 和 TRON 不在本次 EVM 适配范围内。

## 资产和账本

每条链可以部署本链原生代币或已核验合约的 USDT、USDC 托管。每套实例只服务一条链、一种资产和一个合约，使用独立数据库及数据目录。要同时提供多个结算市场，需为各链、资产分别运行 Web 和 worker。当前没有同一实例内的资金账本切换、自动换币、跨链桥或跨资产余额合并。

USDT、USDC 在不同链上可能是发行方原生版本、桥接版本或其他发行方包装版本，不能按名称认定它们相同。部署者必须核对合约地址、发行方或桥、赎回方式与实际可用性。本项目不自动选择稳定币合约，也不把桥接币标为发行方原生币。没有核验合约时，仅部署原生代币；Robinhood 稳定币也适用此规则。核对来源：[Circle 合约目录](https://developers.circle.com/stablecoins/usdc-contract-addresses)、[Tether 支持协议](https://tether.to/en/supported-protocols/)。

所有账本金额和报价使用资产的整数百万分之一，价格按百万 Token 计。`1_000_000` 表示一单位结算资产，ETH、BNB、POL、AVAX 与美元稳定币不做汇率换算。当前单次预算范围为 1–100 单位，商家必须按部署资产重新设价，不能复制另一资产的报价。

链上预算 = 账本预算 × `10 ** (tokenDecimals - 6)`。原生代币为 18 位精度；稳定币部署脚本从选定合约读取 `decimals()`，支持 6–18 位。BSC 上部分包装稳定币是 18 位，不能统一按 6 位处理。钱包原始余额保持完整精度；`ledgerUnit` 是 `micro_<asset>`，`balanceUnit` 为原生 `wei` 或 ERC20 `atomic`，旧测试币仍为 `micro_dUSD`。精度信息来自 `/api/v1/network` 的 `tokenDecimals`。

## 配置和部署

1. 为每个链和资产准备独立 PostgreSQL 数据库或 schema，设置 `DATABASE_URL`，执行 `pnpm db:migrate`。
2. 设置 `TOKEN2API_MODE=evm`、`SETTLEMENT_CHAIN_ID`、`SETTLEMENT_ASSET`。原生资产必须与该链匹配；稳定币另设 `SETTLEMENT_TOKEN_ADDRESS`。可用资产为 `ETH`、`BNB`、`POL`、`AVAX`、`USDT`、`USDC`。
3. 设置 `TOKEN2API_DATA_DIR`，默认为 `.runtime/evm/<chainId>-<asset小写>`。设置部署者、计量者私钥和 `TREASURY_ADDRESS`；私钥只放服务器环境。可通过 `EVM_RPC_URL` 指定 HTTPS RPC。
4. 执行 `pnpm deploy:evm`。脚本先核对 RPC chain ID、资产、合约代码和精度，再部署 `NativeUsageEscrow` 或 `UsageEscrow`。已有目录只允许复用完全匹配的部署，不自动覆盖。此命令会发送目标链部署交易。
5. Web 和 worker 使用相同 `chain.json`；只读文件系统可设置完整 `CHAIN_CONFIG_JSON`。设置 `APP_ORIGIN`、随机 `SESSION_PASSWORD` 和上游允许来源，然后启动服务。

以下以 Ethereum 主网 ETH 结算为配置示例（不含签名密钥）：

```dotenv
TOKEN2API_MODE=evm
SETTLEMENT_CHAIN_ID=1
SETTLEMENT_ASSET=ETH
TOKEN2API_DATA_DIR=.runtime/evm/1-eth
ALLOW_DEMO=false
```

Ethereum 主网 USDT、USDC 分别使用新的数据库与数据目录，将 `SETTLEMENT_ASSET` 设为对应资产并配置已核验的 `SETTLEMENT_TOKEN_ADDRESS`。切换 BSC 等其他网络时，需显式设置对应链 ID 和资产。

原生资产通过交易 `value` 锁定预算。USDT、USDC 先将授权重置为零，再精确授权本次预算，确认后调用 ERC20 托管合约。钱包在各签名步骤检查账号和网络；Gas 始终使用本链原生代币。

## 升级和验证边界

迁移只增加精度元数据与约束，不转换旧金额或资产名称。历史迁移文件保留不改；已停用网络的数据库、合约和运行目录不删除，也不能重标为其他链的余额。未声明资产的旧配置继续按 dUSD 解释；仍受支持的本地旧部署只维护已有会话。

链、资产、代币地址、精度或托管合约任一改变，都必须使用新账本。应用会拒绝绑定不一致的数据库。用量不确定时仍进入 REVIEW 并保留预留；累计结算不得超过预算，结算任务先持久化再发送，恢复依赖 nonce 与回执。

本地演示和公开测试密钥只允许回环链 31337。本次代码支持上述主网的配置与部署，不表示已在各主网发布、审计或完成真实钱包与网关资金验收。上线验收须逐链、逐资产串起预算、真实用量、分账、退款、提现和故障恢复。外部交易当前等待 6 个区块；上线前须核对目标链终局规则。
