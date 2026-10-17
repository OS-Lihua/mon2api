import { Mon2ApiConsole } from "~/app/_components/mon2api-console";
import { WalletProvider } from "~/app/_components/wallet-provider";

export default function Home() {
	return (
		<WalletProvider>
			<Mon2ApiConsole />
		</WalletProvider>
	);
}
