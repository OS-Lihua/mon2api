import type { Metadata } from "next";
import { Token2ApiAdmin } from "~/app/_components/token2api-admin";
import { WalletProvider } from "~/app/_components/wallet-provider";

export const metadata: Metadata = {
	title: "接入管理 · Token2API",
	description: "管理员钱包管理网关和代理白名单，查看关联资源。",
	robots: { index: false, follow: false },
};

export default function AdminPage() {
	return (
		<WalletProvider>
			<Token2ApiAdmin />
		</WalletProvider>
	);
}
