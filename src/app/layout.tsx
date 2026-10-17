import "~/styles/globals.css";

import type { Metadata } from "next";

import { TRPCReactProvider } from "~/trpc/react";

export const metadata: Metadata = {
	title: "mon2api · AI 资源结算网络",
	description: "接入 AI 资源，通过统一 API 调用，在链上结算每一份算力。",
	icons: [{ rel: "icon", url: "/favicon.ico" }],
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
