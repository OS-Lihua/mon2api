import type { Metadata } from "next";
import { Token2ApiAdmin } from "~/app/_components/token2api-admin";
import { WalletProvider } from "~/app/_components/wallet-provider";

export const metadata: Metadata = {
	title: "平台管理 · Token2API",
	description: "管理员钱包配置模型报价与上游路由，审核接入地址和关联资源。",
	robots: { index: false, follow: false },
};

export default function AdminPage() {
	return (
		<WalletProvider>
			<Token2ApiAdmin />
		</WalletProvider>
	);
}
