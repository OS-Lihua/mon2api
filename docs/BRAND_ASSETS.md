# Monad 品牌资料与页面用法

核对日期：2026-10-17。

## 官方来源

- [Brand & Media Kit](https://monad.xyz/brand-and-media-kit)：当前品牌资料入口，包含 Logo、字体和配色。
- [Figma 品牌文件](https://www.figma.com/community/file/1569575393267749711)：官方品牌页链接的设计资源。
- [完整素材包](https://monad.xyz/brand-page-assets/Monad%20Brand%20and%20Media%20Kit.zip)：包含品牌指南、Logo、头像和 MON / WMON 代币图标。
- [Monad 生态品牌文章](https://monadxyz.substack.com/p/marketing-for-monad-native-applications)：介绍社区文化，并提及 Molandak、Chog、Moyaki、Mouch 等角色。

当前官方素材包没有提供这些社区角色的独立原图。社区角色与同名代币项目需区分；后续使用角色插画时，应核对原作者、素材来源和使用条件。

## 配色与字体

| 用途 | 官方色值 |
| --- | --- |
| 主紫色 | `#6E54FF` |
| 浅紫色 | `#DDD7FE` |
| 深色 | `#0E091C` |
| 黑 / 白 | `#000000` / `#FFFFFF` |
| 辅助色 | `#85E6FF`、`#B9E3F9`、`#FF8EE4`、`#FFAE45` |

官方字体分工为：Britti Sans 用于标题，Inter 用于正文，Roboto Mono 用于标签、按钮、链接和代码。mon2api 保留现有中英文字体栈，不额外引入字体文件。

## mon2api 页面

首页使用主紫色、Monad 标识和 MON 代币图标。品牌提示链接到 Monad 官网。mon2api 的名称和相向折带标志保持独立。

以下 SVG 从官方素材包提取，作为本地静态资源提供，仅补充无障碍标题并按项目规范格式化：

- `public/brand/monad/logomark.svg`：源文件 `Logos/Logomark/Logomark.svg`。
- `public/brand/monad/mon-token.svg`：源文件 `Tokens/MON Token 32x32.svg`。

不修改这些素材的内部路径、配色或比例。首页以 Monad 标识说明构建网络，以 MON 图标表达原生结算；具体网络、资产和交易状态仍以钱包和控制台信息为准。
