import type { Metadata } from "next";
import { Token2ApiConsole } from "~/app/_components/token2api-console";
import { WalletProvider } from "~/app/_components/wallet-provider";

export const metadata: Metadata = {
	title: "控制台 · Token2API",
	description:
		"查看当前市场的结算网络与资产，管理 AI 资源、调用预算、用量账单、链上结算和退款。",
};

export default function ConsolePage() {
	return (
		<WalletProvider>
			<Token2ApiConsole />
		</WalletProvider>
	);
}
