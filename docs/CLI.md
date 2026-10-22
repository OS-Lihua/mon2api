# Token2API 商家 CLI

`token2api` 提供完整的终端资源接入和管理流程。AI 负责准备公开配置、预演、查询和普通管理；用户本人负责输入隐私信息。需要 Node.js 24 或更高版本。

## 安装

从自己的平台下载当前安装包，不要求 npm 注册表已经发布：

```sh
npm install --global https://market.example/downloads/token2api-connector-0.2.0.tgz
token2api --version
token2api help --pretty
token2api schema --pretty
```

同一安装包还提供 `token2api-connector`，用于网页复制启动码后的轻量接单流程。两者使用相同连接器协议。源码开发时可使用 `pnpm cli <命令>`；独立安装不需要项目源码、Prisma、数据库配置或其他 npm 运行时依赖。

## 隐私信息必须由用户手动输入

私钥、加密密码、网关 Key、代理认证信息由用户本人在自己的终端输入。终端不回显内容。不要发到聊天里，不要让 AI 读取、代填或打印，不要放在命令参数、公开 JSON 配置或源码里。

需要隐私信息的命令必须使用 `--interactive`，且标准输入必须为真实终端。默认非交互模式、管道或脚本环境返回退出码 **6**，并输出结构化提示，例如：

```json
{
  "schemaVersion": 1,
  "ok": false,
  "error": {
    "code": "manual_input_required",
    "message": "需要用户本人在自己的终端手动输入……",
    "manualCommand": ["token2api", "auth", "login", "--platform", "https://market.example", "--interactive"]
  }
}
```

AI 此时应提醒用户：**“请在你自己的终端运行这条命令并手动输入，不要把私钥、密码或 Key 发给我。完成后我再继续检查。”** 不得通过 PTY、stdin、环境变量或读取凭证文件绕过交接。这里的 `manualCommand` 是参数数组，不应把整个子命令当成一个参数，也不应直接拼接未经转义的 shell 字符串。

## 1. 用户完成钱包登录

可以只为本次登录手动输入私钥，CLI 不保存该私钥：

```sh
token2api auth login --platform https://market.example --interactive
```

推荐由用户先导入加密密钥文件，之后登录只需手动输入文件密码：

```sh
token2api auth import --interactive
token2api auth login --platform https://market.example --interactive
```

导入时用户依次输入私钥、至少 12 字符的加密密码及确认密码。已有密钥文件不会被覆盖。也可通过 `--key-file <加密文件路径>` 指定文件。仅支持本 CLI 的加密文件，不接受明文私钥文件。

CLI 在本地签署 SIWE 登录消息，先核对平台域名、URI、链 ID、用途、nonce 和有效期，再签名。私钥不会上传平台。登录签名不授权转账。公开测试钱包只能用于回环链 31337。

登录后 AI 可以运行：

```sh
token2api auth status
token2api doctor
token2api resource list --limit 20
```

会话有效期为 8 小时，绑定登录平台。换平台不能复用原 Cookie。`doctor` 返回当前链、资产、精度、单位和服务状态；创建报价前先核对资产。

## 2. AI 准备公开资源配置并预演

`gateway.json` 示例：

```json
{
  "transport": "local",
  "name": "我的推理资源",
  "description": "商家授权的文本模型网关",
  "baseUrl": "http://127.0.0.1:3425/v1",
  "model": "YOUR_MODEL_ID",
  "inputRate": 1000000,
  "outputRate": 3000000,
  "concurrency": 1
}
```

`inputRate` 和 `outputRate` 是当前结算资产的整数百万分之一 / 百万 Token。以上报价分别为输入每百万 Token 1 单位资产、输出每百万 Token 3 单位资产。不要传浮点数，不做跨资产换算。本机连接器并发为 1，平台直连为 1–20。

```sh
token2api resource add --file gateway.json --platform https://market.example --dry-run --pretty
```

预演只验证和展示公开配置，不登录、不请求网关、不读取密钥、不创建资源，也不写本地凭证。`schema` 同时提供 `ResourceConfig`、`ConnectionConfig` 和 `ResourceChanges` 的 JSON Schema。配置中出现 `apiKey`、`privateKey`、`password` 等未知字段会被拒绝，不输出字段值。

若还不知道模型 ID，准备仅含 `transport`、`baseUrl` 和可选 `proxy` 的公开连接配置，由用户执行：

```sh
token2api gateway models --file connection.json --interactive
```

CLI 隐藏询问调用 Key，只输出网关返回的模型 ID。它不验证模型实际身份。

## 3. 用户输入网关凭证并创建资源

```sh
token2api resource add --file gateway.json --interactive
```

- `transport: local`：CLI 在本机读取模型，核对选定模型后创建资源。网关 Key、连接器凭证和可选代理认证信息加密保存在本地，不上传平台。用户需设置本机凭证文件密码。
- `transport: direct`：把 `baseUrl` 改为平台可访问的 HTTPS 地址。CLI 会明确提示调用 Key 和代理认证信息将上传到指定平台加密保存。完整网关地址和代理地址仍须通过后台白名单。

可选代理只在公开配置保存地址和是否需要认证：

```json
{
  "proxy": {
    "url": "https://proxy.example.com:8080",
    "authentication": true
  }
}
```

需要认证时，用户名和密码由用户在终端隐藏输入。带认证的远程代理须使用 HTTPS；HTTP 认证仅允许 `localhost`、`127.0.0.1`、`[::1]` 回环地址。不安全的公开配置会在询问凭证前被拒绝，已有加密配置在启动时也会检查。省略 `proxy` 为直连；`authentication: false` 不询问代理认证。代理只影响上游模型发现和推理，不代理平台的登录或管理请求。本机模式由本机网络访问代理，不受平台直连白名单核验。

本机资源创建后先显示离线，返回公开资源 ID 和下一条启动命令，不返回连接器凭证。用户执行：

```sh
token2api connector start --id RESOURCE_ID --interactive
```

手动输入本机凭证文件密码后持续接单，Ctrl+C 停止。接单进程只解锁单个资源的凭证，不读取钱包私钥。关闭终端或机器重启后，需由用户重新解锁。后台进程的低层凭据配置见[本机连接器](./LOCAL_CONNECTOR.md)，AI 不得代填或读取这些凭据。

## 4. AI 管理资源

```sh
token2api resource list --limit 20
token2api resource list --limit 20 --cursor NEXT_CURSOR
token2api resource get --id RESOURCE_ID
token2api connector status --id RESOURCE_ID
token2api resource pause --id RESOURCE_ID --dry-run
token2api resource pause --id RESOURCE_ID
token2api resource resume --id RESOURCE_ID
token2api resource update --id RESOURCE_ID --file changes.json --dry-run
token2api resource update --id RESOURCE_ID --file changes.json
```

`changes.json` 可修改名称、说明、输入输出报价和并发，不可替换模型、网关或凭证。变更报价只影响新消费会话，已有会话保留价格快照。重新上架仍受后台白名单约束。

要更换本机连接地址、网关 Key 或恢复丢失的本机凭证，用户执行：

```sh
token2api connector configure --id RESOURCE_ID --file connection.json --interactive
```

这里的连接配置仅包含 `baseUrl` 和可选 `proxy`，不包含 `transport` 或报价。CLI 验证网关仍提供资源固定模型后，轮换连接器凭证并加密保存，旧连接器随即失效。

## 输出、失败和重试

普通命令 stdout 输出一个 JSON 对象：`{schemaVersion: 1, ok: true, data: ...}` 或 `{schemaVersion: 1, ok: false, error: ...}`。`--pretty` 格式化 JSON，`--json` 可显式声明默认输出格式。连接器持续运行时 stdout 为 NDJSON，每行包含一个事件。用户提示和运行目标说明写入 stderr。

| 退出码 | 含义 | AI 下一步 |
| --- | --- | --- |
| 0 | 成功 | 读取 `data`；分页使用 `nextCursor` |
| 1 | 其他故障 | 检查安全错误说明 |
| 2 | 参数或配置错误 | 按 `schema` 修正公开配置 |
| 3 | 未登录、过期或平台不匹配 | 提醒用户手动登录 |
| 4 | 权限不足或登录消息不安全 | 检查钱包归属、平台地址和白名单 |
| 5 | 冲突 | 先查询当前状态 |
| 6 | 需要用户手动处理隐私信息 | 停止敏感操作并交给用户，禁止代填 |
| 7 | 网络故障、不可用或写入结果未知 | 查询状态；不可盲目重试写入 |
| 130 | 用户取消 | 停止操作 |

所有 HTTP 写操作和推理都不自动重试。`outcome_unknown` 表示可能已成功，应先 `resource list` 核对；不要重复创建。若资源已创建但本机凭证保存失败，错误会返回公开资源 ID，由用户通过 `connector configure` 恢复，AI 不需要获取凭证。

## 本地状态

默认位于 `~/.config/token2api/<profile>/`。`--profile <name>` 隔离不同配置，`--config-dir <path>` 或 `TOKEN2API_CONFIG_DIR` 可指定状态根目录。文件权限 0600，目录 0700；拒绝权限过宽、非本人拥有的凭证文件及符号链接。

钱包密钥和本机资源凭证采用 scrypt 派生密钥与 AES-256-GCM 加密，连接器文件同时绑定平台和资源 ID。管理 Cookie 为了供已授权的 CLI 使用，保存在仅本人可访问的会话文件中；它仍是敏感凭证，AI 不得直接读取、打印或提交此文件。

`auth logout` 清理本地管理会话，即使平台离线也可完成。它不删除加密钱包或连接器配置，也不自动停止已运行的接单进程。本 CLI 不自动转账或提现。
