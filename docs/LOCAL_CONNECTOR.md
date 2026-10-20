# 商家本机连接器

命令使用 `token2api-connector`，凭证环境变量使用 `TOKEN2API_CONNECTOR_TOKEN` 和 `TOKEN2API_UPSTREAM_KEY`。命名规则见[命名规范](./NAMING.md)。

商家可以保留本机 API Key，并出售该 Key 对应的模型调用能力。连接器主动访问 Token2API，不需要开放本机端口。买家通过 Token2API 调用，无法取得商家的上游 Key。

```text
买家 → Token2API 预留预算 → 数据库任务 → 商家连接器 → 本机选定的上游
买家 ← 流式响应与账单 ← 用量核销 ← 结果与用量 ← 上游
```

## 启动

1. 在运行网关的电脑安装 Node.js 24 或更高版本（包含 npm / npx）。商家无需下载 Token2API 源码、安装 pnpm 或配置数据库；可以在任意目录启动连接器。平台数据库迁移由运营者在部署流程中单独执行。
2. 在网页连接钱包并签名登录，打开“我的资源 → 接入资源”。保留“Key 保留在本机”选项，只填写资源名称和简介。此时创建未上架的连接草稿，无需填写模型或价格。API Key 或 OAuth 号池均可通过本机选定的 OpenAI 兼容网关提供。
3. 点击“复制并启动”，在本机终端粘贴运行。一次复制就包含安装包地址、平台地址、上游地址和一次性启动码，无需单独粘贴平台连接凭证。启动码五分钟内有效、只能使用一次；过期或连接失败时重新点击复制。复制命令不会中断现有连接；命令成功兑换后会替换此资源的旧连接凭证。关闭弹窗后可从“我的资源 → 继续接入”恢复。
4. 复制网页提供的完整启动命令，在商家的机器执行。npx 从当前平台下载带版本号的独立安装包并缓存，无需进入项目目录。仅需指定网关地址，不指定模型 ID。Magpie 默认使用下面的地址：

```sh
npx --yes --package=https://market.example/downloads/token2api-connector-0.1.3.tgz token2api-connector start --platform https://market.example --upstream http://127.0.0.1:3425/v1
```

将示例中两处 `https://market.example` 换成真实平台地址。网页复制的命令含 `--connect-code`，CLI 自动兑换平台连接凭证，只用隐藏输入读取本机上游 Key。命令行里没有长期平台凭证或上游 Key。下面不带启动码的手动示例仍会询问平台连接器凭证，可在网页“手动连接（高级）”中获取。不要把长期密钥写进命令行参数。一次性启动码也不要分享；它在兑换或过期后失效。直接使用外部 API 时，将 `--upstream` 换成对应的 HTTPS API 地址。连接器自动读取上游 `/v1/models`，每分钟刷新一次，仅向平台发送模型 ID 列表，不发送上游 URL、Key 或供应商配置。网关返回空列表、错误、无效 ID 或超出限制时明确失败，不会猜测或生成模型 ID。目录最多 500 个模型，响应最多 512 KiB。

5. 回到网页，从自动显示的模型列表选择一个模型，填写输入和输出单价后确认上架。价格单位为当前部署的结算资产 / 百万 Token。未选择模型或连接器离线时不能上架；目录需在两分钟内刷新。草稿不进入公开市场，也不能创建预算会话。一个资源固定一个模型；上架后不可更换模型。网页仅展示网关声明的 ID，不验证真实模型身份。
6. 保持进程运行。连接器每两秒向平台请求任务，或回传在执行任务的进度。15 秒无心跳后资源显示离线并停止接收新调用。Ctrl+C / SIGTERM 会停止进程并尝试通知平台离线。网页的“暂停”阻止新接单，已经领取的任务继续回传用量。

旧的固定模型资源仍可用 `--model <模型 ID>` 启动。已有资源及预算会话不会被模型发现修改。使用自动发现模式时，若挂牌模型不再存在于网关目录中，资源离线且停止接收新调用。

平台直连模式在填写地址与 Key 后点击“读取模型列表”，再从下拉列表选择模型；服务端仅访问运营者允许的上游 origin。

查询自己的连接状态：

```sh
npx --yes --package=https://market.example/downloads/token2api-connector-0.1.3.tgz token2api-connector status --platform https://market.example
```

也可在任意目录全局安装，再使用短命令：

```sh
npm install --global https://market.example/downloads/token2api-connector-0.1.3.tgz
token2api-connector start --platform https://market.example --upstream http://127.0.0.1:3425/v1
token2api-connector --version
```

## 后台运行

这是一个持续运行的 CLI 服务。可交由 systemd、launchd、容器或已有进程管理器管理。建议后台服务全局安装后使用 `token2api-connector`，并固定安装包版本。服务重新启动后只领取新任务，不重复执行之前领取的请求。不自动安装开机启动项。

无人值守时，进程管理器可以从其凭据存储提供 `TOKEN2API_CONNECTOR_TOKEN` 和 `TOKEN2API_UPSTREAM_KEY`。也可使用 `--credentials-stdin`，从标准输入读取下面形状的 JSON。示例中的值均为占位符；不要把真实值写进 shell 历史、仓库、日志或公共部署变量。

```json
{"token":"<平台连接器凭证>","apiKey":"<本机上游 Key>"}
```

上游 Key 只发送到本机配置的上游。平台连接凭证只发送到 `--platform`。两者不能替代钱包管理身份或买家推理 Key。地址必须使用 HTTPS；回环地址可用 HTTP。HTTP 重定向被拒绝，以免转发凭证。

## 计量与故障

- 当前本机资源限制为单并发，支持现有文本 Chat Completions、流式文本及最终 Token 用量。支持从 Magpie 或其他 OpenAI 兼容网关自动读取模型目录；工具调用、图片、多模态和供应商密钥配置导入尚未实现。
- 创建资源不会验证上游模型的身份或执行质量。验收需用真实上游完成调用，并核对用量与账单。OAuth 授权、刷新和账号池调度仍由商家选定的网关负责。
- 任务先写入 Postgres，再由连接器原子领取。已领取任务不会再次派发。连接器不会自动重试上游推理；只允许重传同一版本的累计响应。
- 平台在调用前预留最大费用，继续使用原有价格快照和预算限制。只有尚未领取并成功取消的任务可以释放预留。
- 已领取任务断线、超时、缺失用量或超出预留时，保留预留并进入 REVIEW，不能推断为零费用。连接器不能通过报告“失败”要求平台释放预算。
- 单个任务期限为 40 秒。任务与结果存入数据库以支持交付和人工核对；其中包含请求文本与响应文本。若在期限内收到迟到的用量，平台保存证据但不自动解除 REVIEW。
- 本机连接器通过版本化 REST 工作；网页创建资源和重置凭证使用 tRPC。完整协议见 `/api/v1/openapi.json`。

## 验证

`pnpm verify` 检查格式、类型、单元测试和生产构建。其中安装包测试会从本地 HTTP 下载真实 tgz，通过 npx 在空目录运行，并在独立安装后验证状态查询、模型发现、流式推理、用量回传和正常停止。测试不需要数据库或外部模型。

`pnpm test:connector` 创建隔离数据库 schema，通过真实本地 HTTP/SSE 验证未上架草稿、目录读取、选择模型后上架、连接器、数据库队列和 REST 回传；完成后删除测试 schema，不调用外部模型，也不操作链上资金。

## 打包与发布（平台维护者）

源码开发仍支持 `pnpm connector start/status`。商家使用独立安装包。`pnpm build`、`pnpm dev` 和 `pnpm dev:web` 会先生成安装包，确保网页给出的下载地址存在。单独打包：

```sh
pnpm connector:build
```

生成 `packages/connector/dist/connector.mjs` 和 `public/downloads/token2api-connector-0.1.3.tgz`。安装包包含 JavaScript、包元数据、说明和许可证，无运行时 npm 依赖，也无安装脚本；不包含网站、Prisma、数据库配置、源码映射或凭证。生成文件不入库，由部署构建生成并随 public 目录发布。更新版本时修改 `packages/connector/package.json` 的 `version`，并同步文档中的示例版本；网页命令自动读取该版本。用户需要复制新版网页命令或重新全局安装以升级。

平台托管安装包不依赖 npm 登录。若要发布到 npm，先完成验证并确认 npm 账号拥有 `@token2api` scope 的发布权限，然后在本机登录并发布同一安装包：

```sh
pnpm verify
npm login
npm publish public/downloads/token2api-connector-0.1.3.tgz --access public
```

只有 npm 发布成功后，用户才可改用 `npx --yes @token2api/connector@0.1.3 start ...`。发布前使用网页提供的平台安装包地址。
