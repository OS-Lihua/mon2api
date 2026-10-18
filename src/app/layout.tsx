import "@rainbow-me/rainbowkit/styles.css";
import "~/styles/globals.css";

import type { Metadata } from "next";

import { env } from "~/env";
import { TRPCReactProvider } from "~/trpc/react";

export const metadata: Metadata = {
	metadataBase: new URL(env.APP_ORIGIN),
	applicationName: "Token2API",
	title: "Token2API · AI 资源多链结算平台",
	description:
		"面向 AI 资源交易的多链结算平台。使用主流 EVM 链的原生代币及已开通的 USDT、USDC，锁定预算、按量计费，核对收入与退款。",
	icons: [
		{ rel: "icon", url: "/favicon.ico", sizes: "16x16 32x32 48x48" },
		{
			rel: "icon",
			url: "/icon.svg",
			type: "image/svg+xml",
			sizes: "any",
		},
	],
};

export default function RootLayout({
	children,
}: Readonly<{ children: React.ReactNode }>) {
	return (
		<html lang="zh-CN">
			<body>
				<TRPCReactProvider>{children}</TRPCReactProvider>
			</body>
		</html>
	);
}
