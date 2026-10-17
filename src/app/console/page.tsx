import type { Metadata } from "next";
import { Mon2ApiConsole } from "~/app/_components/mon2api-console";
import { WalletProvider } from "~/app/_components/wallet-provider";

export const metadata: Metadata = { title: "控制台 · mon2api" };

export default function ConsolePage() {
	return (
		<WalletProvider>
			<Mon2ApiConsole />
		</WalletProvider>
	);
}
