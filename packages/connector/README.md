# Token2API 本机连接器

新版命令为 `token2api-connector`；`mon2api-connector` 仍作为兼容别名。凭证环境变量保持原名。

需要 Node.js 24 或更高版本（包含 npm / npx）。无需下载 Token2API 源码、安装数据库或进入项目目录。

在 Token2API 网页创建本机连接后，点击“复制并启动”，一次复制完整命令，包含五分钟内有效、只能使用一次的启动码。无需单独复制连接凭证。平台会提供带版本号的独立安装包，首次运行时由 npx 下载并缓存。可以在任意目录执行，例如：

```sh
npx --yes --package=https://market.example/downloads/token2api-connector-0.1.2.tgz token2api-connector start --platform https://market.example --upstream http://127.0.0.1:3425/v1
```

将示例中的 `https://market.example` 换成实际平台地址。网页复制的命令带有 `--connect-code`，运行后只需隐藏输入本机上游 API Key。手动示例不带启动码时，仍会额外询问平台连接器凭证。不要把长期密钥放进命令行参数。启动码失效时回到网页重新复制。连接器读取上游模型列表后，回到网页选择模型和报价并上架。保持终端运行，Ctrl+C 停止。

也可先在任意目录安装，再用短命令启动：

```sh
npm install --global https://market.example/downloads/token2api-connector-0.1.2.tgz
token2api-connector start --platform https://market.example --upstream http://127.0.0.1:3425/v1
token2api-connector status --platform https://market.example
token2api-connector --help
token2api-connector --version
```

旧的固定模型资源可增加 `--model <模型 ID>`。其他 OpenAI 兼容网关可替换 `--upstream`；必须为 HTTPS，只有回环地址允许 HTTP。

无人值守时，通过进程管理器的凭据存储提供 `MON2API_CONNECTOR_TOKEN` 和 `MON2API_UPSTREAM_KEY`，或用 `--credentials-stdin` 从标准输入读取 `{"token":"...","apiKey":"..."}`。连接器不自动保存凭证，也不安装开机启动项。上游 Key 只发送给本机配置的上游，平台只收到模型 ID、任务响应和用量。

支持文本 Chat Completions 和流式响应。上游调用不会自动重试；用量不确定时由平台保留预算并进入 REVIEW，等待核对。

维护者可将同一安装包发布到 npm。发布前，不要使用 `npx @token2api/connector`，请使用网页给出的平台安装包地址。
