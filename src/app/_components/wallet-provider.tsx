"use client";

import {
	connectorsForWallets,
	createAuthenticationAdapter,
	lightTheme,
	RainbowKitAuthenticationProvider,
	RainbowKitProvider,
} from "@rainbow-me/rainbowkit";
import {
	injectedWallet,
	metaMaskWallet,
	rabbyWallet,
	rainbowWallet,
	walletConnectWallet,
} from "@rainbow-me/rainbowkit/wallets";
import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import type { Address } from "viem";
import {
	createConfig,
	http,
	type State,
	useAccount,
	useConfig,
	useDisconnect,
	WagmiProvider,
} from "wagmi";
import { getAccount } from "wagmi/actions";
import { env } from "~/env";
import { defineWalletChain, getConnectedWallet } from "~/lib/wallet";
import type { NetworkInfo } from "~/shared/token2api";
import { uiPreview } from "~/shared/ui-preview";
import { api } from "~/trpc/react";

type WalletContextValue = {
	address: Address | undefined;
	isConnected: boolean;
	disconnect: () => Promise<void>;
	getWallet: (
		network: NetworkInfo,
		expectedAddress?: string,
	) => ReturnType<typeof getConnectedWallet>;
};
const WalletContext = createContext<WalletContextValue | null>(null);

export function useToken2ApiWallet() {
	const context = useContext(WalletContext);
	if (!context) throw new Error("钱包连接服务尚未就绪。");
	return context;
}

function configureWallet(network: NetworkInfo) {
	const projectId = env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? "";
	const chain = defineWalletChain(network);
	const wallets = projectId
		? [
				metaMaskWallet,
				rabbyWallet,
				rainbowWallet,
				injectedWallet,
				walletConnectWallet,
			]
		: [rabbyWallet, injectedWallet];
	return createConfig({
		chains: [chain],
		connectors: connectorsForWallets([{ groupName: "连接钱包", wallets }], {
			appName: "Token2API",
			projectId,
		}),
		multiInjectedProviderDiscovery: true,
		ssr: true,
		transports: { [chain.id]: http(network.rpcUrl) },
	});
}

export function WalletProvider({ children }: { children: React.ReactNode }) {
	const snapshot = api.token2api.snapshot.useQuery(
		{ gatewayOnly: true },
		{ retry: 1 },
	);
	const network = snapshot.data?.network;
	if (uiPreview) {
		return (
			<WalletContext.Provider
				value={{
					address: undefined,
					isConnected: false,
					disconnect: async () => {},
					getWallet: () => {
						throw new Error("UI 预览模式不连接钱包。");
					},
				}}
			>
				{children}
			</WalletContext.Provider>
		);
	}
	if (!network) {
		return (
			<div className="wallet-loading" role="status">
				<strong>Token2API</strong>
				<span>
					{snapshot.error
						? "连接服务暂不可用，请确认服务已启动。"
						: "正在载入资源网络…"}
				</span>
				{snapshot.error && (
					<button
						className="button primary"
						disabled={snapshot.isFetching}
						onClick={() => void snapshot.refetch()}
						type="button"
					>
						重新连接
					</button>
				)}
			</div>
		);
	}
	return (
		<ConfiguredWalletProvider
			key={`${network.chainId}:${network.rpcUrl}`}
			network={network}
		>
			{children}
		</ConfiguredWalletProvider>
	);
}

function ConfiguredWalletProvider({
	children,
	network,
}: {
	children: React.ReactNode;
	network: NetworkInfo;
}) {
	const [config] = useState(() => configureWallet(network));
	// Keep the first render pending until wagmi restores and checks the saved connector.
	const [initialState] = useState<State>(() => ({
		chainId: network.chainId,
		connections: new Map(),
		current: null,
		status: "reconnecting",
	}));
	return (
		<WagmiProvider config={config} initialState={initialState}>
			<WalletSessionProvider>{children}</WalletSessionProvider>
		</WagmiProvider>
	);
}

function WalletSessionProvider({ children }: { children: React.ReactNode }) {
	const account = useAccount();
	const config = useConfig();
	const { disconnectAsync } = useDisconnect();
	const snapshot = api.token2api.snapshot.useQuery({ gatewayOnly: true });
	const challenge = api.token2api.walletChallenge.useMutation();
	const login = api.token2api.walletLogin.useMutation();
	const { mutateAsync: logout } = api.token2api.logout.useMutation();
	const clearing = useRef<Promise<void> | null>(null);
	const [sessionError, setSessionError] = useState(false);
	const viewer = snapshot.data?.viewer;
	const address = account.address;
	const authenticated =
		!!viewer &&
		!viewer.demo &&
		account.isConnected &&
		viewer.address.toLowerCase() === address?.toLowerCase();

	const { refetch } = snapshot;
	const clearSession = useCallback(() => {
		clearing.current ??= (async () => {
			await logout();
			await refetch();
			setSessionError(false);
		})().finally(() => {
			clearing.current = null;
		});
		return clearing.current;
	}, [logout, refetch]);
	// A connection only selects a signer. The server challenge proves ownership.
	const adapter = createAuthenticationAdapter({
		// The existing backend creates the nonce with the address-bound message.
		getNonce: async () => "server-challenge",
		createMessage: async ({ address: signingAddress }) => {
			const { message } = await challenge.mutateAsync({
				address: signingAddress,
			});
			return message;
		},
		verify: async ({ message, signature }) => {
			const signingAddress = getAccount(config).address;
			if (!signingAddress) return false;
			const matches = () => {
				const current = getAccount(config);
				return (
					current.isConnected &&
					current.address?.toLowerCase() === signingAddress.toLowerCase()
				);
			};
			await clearSession();
			if (!matches()) return false;
			await login.mutateAsync({ address: signingAddress, message, signature });
			if (!matches()) {
				await clearSession();
				return false;
			}
			await snapshot.refetch();
			if (!matches()) {
				await clearSession();
				return false;
			}
			return true;
		},
		signOut: clearSession,
	});

	useEffect(() => {
		if (
			!viewer ||
			viewer.demo ||
			account.isConnecting ||
			account.isReconnecting ||
			authenticated
		)
			return;
		void clearSession().catch(() => setSessionError(true));
	}, [
		viewer,
		account.isConnecting,
		account.isReconnecting,
		authenticated,
		clearSession,
	]);

	const context = useMemo<WalletContextValue>(
		() => ({
			address,
			isConnected: account.isConnected,
			disconnect: async () => {
				await disconnectAsync();
			},
			getWallet: (network, expectedAddress) =>
				getConnectedWallet(config, network, expectedAddress),
		}),
		[address, account.isConnected, config, disconnectAsync],
	);
	return (
		<WalletContext.Provider value={context}>
			{sessionError && (
				<div className="wallet-session-error" role="alert">
					钱包身份已变化，正在停止旧身份操作。
					<button
						onClick={() => {
							void clearSession().catch(() => setSessionError(true));
						}}
						type="button"
					>
						重试退出
					</button>
				</div>
			)}
			<RainbowKitAuthenticationProvider
				adapter={adapter}
				status={
					snapshot.isPending
						? "loading"
						: authenticated
							? "authenticated"
							: "unauthenticated"
				}
			>
				<RainbowKitProvider
					appInfo={{ appName: "Token2API" }}
					locale="zh-CN"
					modalSize="compact"
					theme={lightTheme({
						accentColor: "var(--brand-lime)",
						accentColorForeground: "var(--ink)",
						borderRadius: "medium",
						fontStack: "system",
						overlayBlur: "small",
					})}
				>
					{children}
				</RainbowKitProvider>
			</RainbowKitAuthenticationProvider>
		</WalletContext.Provider>
	);
}
