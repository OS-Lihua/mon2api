# Token2API 命名规范

- 产品名称与界面文案：`Token2API`。
- 文件、目录、包名和协议命名空间：`token2api`，例如 `token2api-console.tsx`、`@token2api/connector`、`token2api.snapshot`。
- React 组件与类型中的产品名称：`Token2Api`，例如 `Token2ApiConsole`、`useToken2ApiWallet`。
- 环境变量前缀：`TOKEN2API_`。
- 钱包会话 Cookie：`token2api_session`。
- REST 计费元数据字段：`token2api`。
- 本机连接器命令：`token2api-connector`。
- 默认数据库与 Docker Compose 项目名：`token2api`。

仅维护上述规范名称。部署使用当前配置和迁移目录初始化数据库，不提供旧命名的配置读取、协议别名或迁移记录转换。
