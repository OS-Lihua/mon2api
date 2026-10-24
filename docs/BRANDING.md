# Token2API 品牌资产

采用「折译」标志和「酸橙石墨」配色。标志通过一道竖向切口保留数字 2 的线索，表达把模型能力转换为统一 API。

## 颜色与变量

| 用途 | 色值 | CSS 变量 |
| --- | --- | --- |
| 酸橙绿 | `#D1F344` | `--brand-lime` |
| 深橄榄 | `#2F3C15` | `--brand-olive`、`--accent` |
| 石墨黑 | `#171C13` | `--brand-graphite`、`--ink`、`--deep` |
| 暖白 | `#F7F9EE` | `--brand-paper`、`--frost` |

颜色定义集中在 `src/styles/globals.css`。主按钮采用酸橙绿底、石墨黑字和深色边框；悬停与按下沿用对应品牌变量。浅底链接和焦点边框使用深橄榄色。深色导航与代码区使用石墨黑，深底焦点使用酸橙绿。

酸橙绿不直接用于浅底小号文字。成功、警告、错误、资金审核和未知用量仍使用独立语义状态与文字说明，品牌色不改变业务状态。

## 页面标志

- `public/brand/logo-light.svg`：浅底深橄榄符号与石墨黑字标。
- `public/brand/logo-dark.svg`：深底酸橙绿符号与白色字标。
- `src/app/_components/brand-logo.tsx`：统一品牌图像入口，使用 Next.js Image 直接展示可信的本地 SVG。

两个 SVG 均为可编辑路径，字标已转轮廓，不依赖浏览器加载字体。保持宽高比，不另加句点或用页面字体重排字标。

横向组合画布高度至少为 32px，常用 36–40px。可见符号四周留白至少为其高度的 1/4；组合文件已经固定图文比例与间距。

## 浏览器与安装图标

- `public/icon.svg` 与 `public/favicon.ico`：酸橙绿底、石墨黑符号。ICO 包含 16、32、48px。
- `public/icons/icon-192.png`、`icon-512.png`：常规安装图标。
- `public/icons/icon-maskable-512.png`：预留中央安全区的可遮罩图标。
- `src/app/apple-icon.png`：180px Apple 图标。
- `src/app/manifest.ts`：暖白启动背景与石墨黑安装主题色。

更换符号时需同步这些导出；maskable 图标应保持中央安全区，不直接替换为普通图标。

## 网页分享图

`src/app/opengraph-image.png` 是 1200×630px 的分享图，沿用同一标志与配色。可编辑源文件为 `public/brand/share.svg`；更新后需同步导出 PNG 和 `src/app/opengraph-image.alt.txt`。分享图中的品牌字标为轮廓路径，中文说明使用系统字体。

## 字体许可

字母轮廓基于 Manrope 620，数字 2 为自绘字形，字距经过调整。Manrope 版权归 Manrope Project Authors，字体采用 SIL Open Font License 1.1；许可副本位于 `public/brand/Manrope-OFL.txt`。
