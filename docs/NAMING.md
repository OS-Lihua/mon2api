# Token2API 命名与兼容

- 产品名称与界面文案：`Token2API`。
- 文件、目录、包名和协议命名空间：`token2api`，例如 `token2api-console.tsx`、`@token2api/connector`、`token2api.snapshot`。
- React 组件与类型中的产品名称：`Token2Api`，例如 `Token2ApiConsole`、`useToken2ApiWallet`。
- 环境变量前缀：`TOKEN2API_`。新的变量优先于同名的旧前缀变量。

## 现有部署

旧配置通过以下兼容入口继续工作；新文档和新客户端统一使用规范名称：

| 新名称 | 兼容入口 |
| --- | --- |
| `TOKEN2API_MODE`、`TOKEN2API_DATA_DIR` | 对应的 `MON2API_*` 变量 |
| `TOKEN2API_CONNECTOR_TOKEN`、`TOKEN2API_UPSTREAM_KEY` | 对应的 `MON2API_*` 变量 |
| `TOKEN2API_RECOVERY_TEST` | `MON2API_RECOVERY_TEST` |
| `token2api_session` Cookie | 没有新 Cookie 时读取 `mon2api_session`；退出时清除两者 |
| tRPC `token2api.*` | `mon2api.*` 路由别名 |
| REST 响应 `token2api` 计费元数据 | 同时返回内容相同的 `mon2api` 字段 |
| `token2api-connector` | 原有连接器命令别名 |

Docker Compose 项目名、数据库名、已写入的演示资源 ID、历史迁移目录和链上部署不随品牌修改而重命名。更改这些名称可能切换数据卷、重复初始化或破坏迁移记录。已有资源和会话的模型名也保持原值；新建演示资源使用 `token2api-demo`。

链上签名发送的数据库锁标识继续沿用旧值，确保升级期间新旧进程仍竞争同一把锁。不得通过品牌改名转换、重解释或复用已有资金账本。
