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

链上预算 = 账本预算 × `10 ** (tokenDecimals - 6)`。原生代币为 18 位精度；稳定币部署脚本从选定合约读取 `decimals()`，支持 6–18 位。BSC 上部分包装稳定币是 18 位，不能统一按 6 位处理。钱包原始余额保持完整精度；`ledgerUnit` 是 `micro_<asset>`，`balanceUnit` 为原生 `wei` 或 ERC20 `atomic`。精度信息来自 `/api/v1/network` 的 `tokenDecimals`。

## 配置和部署

1. 为每个链和资产准备独立 PostgreSQL 数据库或 schema，设置 `DATABASE_URL`，执行 `pnpm db:migrate`。
2. 设置 `TOKEN2API_MODE=evm`、`SETTLEMENT_CHAIN_ID`、`SETTLEMENT_ASSET`。原生资产必须与该链匹配；稳定币另设 `SETTLEMENT_TOKEN_ADDRESS`。可用资产为 `ETH`、`BNB`、`POL`、`AVAX`、`USDT`、`USDC`。
3. 设置 `TOKEN2API_DATA_DIR`，默认为 `.runtime/evm/<chainId>-<asset小写>`。设置唯一的 `ESCROW_OWNER_PRIVATE_KEY`，用于部署、计量结算、管理和平台手续费收款；私钥只放服务器环境。可通过 `EVM_RPC_URL` 指定 HTTPS RPC。
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

## 单钱包管理

ERC20 与原生币托管合约均由一个 `owner` 钱包管理。部署只配置 `ESCROW_OWNER_PRIVATE_KEY`；公开链配置不保存管理地址，服务端发送结算前读取链上 `owner()`。平台手续费在结算时记入当时管理员的可提现余额。管理钱包仍受每个会话的预算、序号和结算期限限制；回执哈希不证明真实用量。

以下命令使用当前部署的公开链配置。`status` 不需要私钥，也不连接数据库；其他命令会发送链上交易。除查看状态外，先暂停 worker，避免同一钱包并发发送交易争用 nonce。每条命令输出交易哈希，目标网络等待 6 个确认；中断后可按哈希核对回执。

```bash
pnpm escrow:admin status
pnpm escrow:admin pause
pnpm escrow:admin transfer 0x新管理钱包地址
# 如需撤销尚未完成的交接：pnpm escrow:admin cancel-transfer
# 使用新钱包的 ESCROW_OWNER_PRIVATE_KEY 执行接受交接
pnpm escrow:admin accept
pnpm escrow:admin unpause
pnpm escrow:admin withdraw
# 原生币还可以指定同一网络的收款地址
pnpm escrow:admin withdraw 0x收款地址
```

交接时，旧钱包执行 `transfer`，新钱包执行 `accept` 后才生效；确认前旧钱包保有全部管理与计量权限，候选钱包没有权限。确认后，Web、worker 和操作命令的 `ESCROW_OWNER_PRIVATE_KEY` 更新为新钱包私钥，再重启服务。旧私钥会因链上身份不匹配而被拒绝。已分配给旧钱包的手续费仍归旧钱包，可用旧私钥执行 `withdraw`；交接只影响未来结算分配。禁止放弃管理权。

`pause` 阻止新存款、计量结算和管理员提前关闭会话。服务端的新会话与调用也会检查暂停状态，状态读取最多缓存 1 秒；已经执行中的上游调用不会因此撤销。暂停不阻止消费者申请关闭、等待原有 120 秒窗口后退出，或提取已到账余额。单钱包私钥丢失后无法恢复管理权，被盗时也不能保证抢先交接。

本次管理协议需要部署新版合约并使用独立账本。已有合约、余额和会话不会自动升级，不能把原数据库直接改绑新合约。待核对用量仍使用现有数据库预留，尚未加入链上预留或更改超时退款规则。

## 升级和验证边界

配置必须明确声明结算资产，不接受旧测试币、缺少资产的配置或旧协议凭证。部署只支持当前合约。数据库迁移记录保留以保证迁移可追踪，但运行时不维护旧部署兼容路径；迁移不会转换已有余额或资产名称。

升级前运行 `pnpm db:migrate`，创建签名交易 outbox 并删除 ChainBinding 的隐式元数据默认值。已有旧资产账本不会被改名或换算；新部署须使用隔离账本。消费者密钥、连接器凭证和启动码分别使用 `t2a_`、`t2c_`、`t2l_`；升级后重新创建密钥并重新连接本机资源。连接器安装包为 0.1.5。

结算先保存业务任务，再在短签名锁内分配钱包 nonce、签名并保存交易原文和哈希。发送和区块确认在数据库事务外执行。多个进程共用数据库中的 nonce 上限，重试复用已保存的交易；后续发送也会补发尚未确认的较小 nonce，避免进程在发送前退出留下空档。worker 最多并发处理 4 个不同会话，确认慢的会话不会占用全局签名锁。

链、资产、代币地址、精度或托管合约任一改变，都必须使用新账本。应用会拒绝绑定不一致的数据库。用量不确定时仍进入 REVIEW 并保留预留；累计结算不得超过预算，结算任务先持久化再发送，恢复依赖 nonce 与回执。

本地演示和公开测试密钥只允许回环链 31337。本次代码支持上述主网的配置与部署，不表示已在各主网发布、审计或完成真实钱包与网关资金验收。上线验收须逐链、逐资产串起预算、真实用量、分账、退款、提现和故障恢复。外部交易当前等待 6 个区块；上线前须核对目标链终局规则。
