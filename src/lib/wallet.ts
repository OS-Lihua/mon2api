import {
	createPublicClient,
	defineChain,
	getAddress,
	http,
	walletActions,
} from "viem";
import type { Config } from "wagmi";
import { getAccount, getConnectorClient, switchChain } from "wagmi/actions";
import type { NetworkInfo } from "~/shared/mon2api";
import { networkMetadata, settlementChain } from "~/shared/network";

export function defineWalletChain(network: NetworkInfo) {
	if (network.mode === "local" && network.chainId !== 31337)
		throw new Error("本地链必须使用 chain 31337。");
	if (network.mode === "evm") settlementChain(network.chainId);
	const rpc = new URL(network.rpcUrl);
	if (
		!["http:", "https:"].includes(rpc.protocol) ||
		rpc.username ||
		rpc.password ||
		(network.mode === "local" &&
			!["127.0.0.1", "localhost"].includes(rpc.hostname))
	)
		throw new Error("钱包网络 RPC 配置无效。");
	return defineChain({
		id: network.chainId,
		name: network.name,
		nativeCurrency: {
			name: networkMetadata(network).nativeName,
			symbol: networkMetadata(network).nativeSymbol,
			decimals: 18,
		},
		rpcUrls: { default: { http: [network.rpcUrl] } },
	});
}

export async function getConnectedWallet(
	config: Config,
	network: NetworkInfo,
	expectedAddress?: string,
) {
	const chain = defineWalletChain(network);
	if (!network.ready) throw new Error("链服务尚未就绪，请稍后重试。");
	if (!config.chains.some((configured) => configured.id === network.chainId))
		throw new Error("钱包未配置此网络。");
	const connection = getAccount(config);
	const connector = connection.connector;
	if (!connection.isConnected || !connector) throw new Error("请先连接钱包。");
	const expected = expectedAddress ? getAddress(expectedAddress) : undefined;
	const readLive = async () => {
		const [accounts, chainId] = await Promise.all([
			connector.getAccounts(),
			connector.getChainId(),
		]);
		const selected = accounts[0];
		if (!selected) throw new Error("钱包未返回可用账户。");
		const account = getAddress(selected);
		if (expected && account !== expected)
			throw new Error("钱包当前账户与登录账户不一致，请切回原账户或重新登录。");
		return { account, chainId };
	};
	const before = await readLive();
	if (before.chainId !== network.chainId) {
		// User rejection propagates; do not turn it into an add-chain/sign request.
		await switchChain(config, { connector, chainId: network.chainId });
	}
	const after = await readLive();
	if (after.account !== before.account)
		throw new Error("钱包账户在操作期间发生变化，请重试。");
	if (after.chainId !== network.chainId)
		throw new Error("钱包未切换到目标网络，请重试。");
	const current = getAccount(config);
	if (!current.isConnected || current.connector?.uid !== connector.uid)
		throw new Error("钱包连接已发生变化，请重新连接。");
	const client = await getConnectorClient(config, {
		connector,
		chainId: network.chainId,
		account: after.account,
	});
	const final = await readLive();
	if (final.account !== after.account || final.chainId !== network.chainId)
		throw new Error("钱包账户或网络在操作期间发生变化，请重试。");
	const finalConnection = getAccount(config);
	if (
		!finalConnection.isConnected ||
		finalConnection.connector?.uid !== connector.uid
	)
		throw new Error("钱包连接已发生变化，请重新连接。");
	return {
		wallet: client.extend(walletActions),
		account: after.account,
		publicClient: createPublicClient({
			chain,
			transport: http(network.rpcUrl),
		}),
	};
}
