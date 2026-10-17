import { afterEach, describe, expect, it, vi } from "vitest";
import { createConfig, http } from "wagmi";
import { connect, disconnect, getAccount } from "wagmi/actions";
import { mock } from "wagmi/connectors";
import type { NetworkInfo } from "~/shared/mon2api";
import { defineWalletChain, getConnectedWallet } from "./wallet";

const first = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const second = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const local: NetworkInfo = {
	asset: "MON",
	ledgerUnit: "micro_MON",
	balanceUnit: "wei",
	mode: "local",
	name: "Local EVM",
	chainId: 31337,
	rpcUrl: "http://127.0.0.1:8545",
	ready: true,
	token: "",
	escrow: "",
	feeBps: 500,
	explorer: "",
};
const testnet: NetworkInfo = {
	...local,
	mode: "monad-testnet",
	name: "Monad Testnet",
	chainId: 10143,
	rpcUrl: "https://testnet-rpc.monad.xyz",
};
type Features = Parameters<typeof mock>[0]["features"];

async function fixture(features?: Features, connected = true) {
	const config = createConfig({
		chains: [defineWalletChain(local), defineWalletChain(testnet)],
		connectors: [mock({ accounts: [first], features })],
		transports: { 31337: http(), 10143: http() },
		storage: null,
		ssr: true,
		multiInjectedProviderDiscovery: false,
	});
	const connector = config.connectors[0];
	if (!connector) throw new Error("Missing mock connector");
	if (connected) await connect(config, { connector });
	// The mock forwards eth_accounts to its chain RPC. Replace only that read;
	// connect, chain changes, client creation and rejection use real Wagmi code.
	const liveAccounts = vi
		.spyOn(connector, "getAccounts")
		.mockResolvedValue([first]);
	return { config, connector, liveAccounts };
}

afterEach(() => {
	vi.restoreAllMocks();
});

describe("selected Wagmi connector wallet", () => {
	it("uses the connected connector without a browser-injected wallet", async () => {
		const { config, liveAccounts } = await fixture();
		const result = await getConnectedWallet(config, local, first.toLowerCase());
		expect(result.account).toBe(first);
		expect(result.wallet.account.address).toBe(first);
		expect(result.wallet.chain?.id).toBe(31337);
		expect(typeof result.wallet.writeContract).toBe("function");
		expect(result.publicClient.chain.id).toBe(31337);
		expect(liveAccounts).toHaveBeenCalled();
	});

	it("refuses an unconnected wallet", async () => {
		const { config } = await fixture(undefined, false);
		await expect(getConnectedWallet(config, local)).rejects.toThrow(
			"请先连接钱包",
		);
	});

	it("rejects an account mismatch before asking to switch the network", async () => {
		const { config, connector } = await fixture();
		const switchNetwork = vi.spyOn(connector, "switchChain");
		await expect(getConnectedWallet(config, testnet, second)).rejects.toThrow(
			"账户不一致",
		);
		expect(switchNetwork).not.toHaveBeenCalled();
	});

	it("reads live accounts even when Wagmi still holds an older active address", async () => {
		const { config, liveAccounts } = await fixture();
		liveAccounts.mockResolvedValue([second, first]);
		expect(getAccount(config).address).toBe(first);
		await expect(getConnectedWallet(config, local, first)).rejects.toThrow(
			"账户不一致",
		);
	});

	it("switches to the requested network through the selected connector", async () => {
		const { config, connector } = await fixture();
		const switchNetwork = vi.spyOn(connector, "switchChain");
		const result = await getConnectedWallet(config, testnet, first);
		expect(switchNetwork).toHaveBeenCalledWith(
			expect.objectContaining({ chainId: 10143 }),
		);
		expect(await connector.getChainId()).toBe(10143);
		expect(result.wallet.chain?.id).toBe(10143);
	});

	it("propagates a rejected switch and keeps the original chain", async () => {
		const { config, connector } = await fixture({ switchChainError: true });
		const switchNetwork = vi.spyOn(connector, "switchChain");
		await expect(getConnectedWallet(config, testnet, first)).rejects.toThrow(
			"User rejected",
		);
		expect(switchNetwork).toHaveBeenCalledTimes(1);
		expect(await connector.getChainId()).toBe(31337);
	});

	it("rejects an account changed during the chain switch", async () => {
		const { config, liveAccounts } = await fixture();
		liveAccounts.mockResolvedValueOnce([first]).mockResolvedValue([second]);
		await expect(getConnectedWallet(config, testnet, first)).rejects.toThrow(
			"账户不一致",
		);
	});

	it("checks the actual chain again after a connector claims switch success", async () => {
		const { config, connector } = await fixture();
		vi.spyOn(connector, "getChainId").mockResolvedValue(31337);
		await expect(getConnectedWallet(config, testnet, first)).rejects.toThrow(
			"未切换到目标网络",
		);
	});

	it("rechecks live accounts after the signing client was created", async () => {
		const { config, liveAccounts } = await fixture();
		liveAccounts
			.mockResolvedValueOnce([first])
			.mockResolvedValueOnce([first])
			.mockResolvedValueOnce([first])
			.mockResolvedValue([second]);
		await expect(getConnectedWallet(config, local, first)).rejects.toThrow(
			"账户不一致",
		);
	});

	it("rejects a disconnection while the signing client is being prepared", async () => {
		const { config, liveAccounts } = await fixture();
		liveAccounts
			.mockResolvedValueOnce([first])
			.mockResolvedValueOnce([first])
			.mockResolvedValueOnce([first])
			.mockImplementationOnce(async () => {
				await disconnect(config);
				return [first];
			});
		await expect(getConnectedWallet(config, local, first)).rejects.toThrow(
			"连接已发生变化",
		);
	});

	it("preserves user rejection when signing with the returned wallet", async () => {
		const { config } = await fixture({ signMessageError: true });
		const { wallet, account } = await getConnectedWallet(config, local, first);
		await expect(
			wallet.signMessage({ account, message: "local test challenge" }),
		).rejects.toThrow("User rejected");
	});

	it("rejects missing live accounts and an unavailable backend chain", async () => {
		const { config, liveAccounts } = await fixture();
		liveAccounts.mockResolvedValue([]);
		await expect(getConnectedWallet(config, local)).rejects.toThrow(
			"未返回可用账户",
		);
		await expect(
			getConnectedWallet(config, { ...local, ready: false }),
		).rejects.toThrow("尚未就绪");
	});

	it("rejects an unsupported chain or non-local development RPC", () => {
		expect(() => defineWalletChain({ ...testnet, chainId: 1 })).toThrow(
			"仅支持",
		);
		expect(() =>
			defineWalletChain({ ...local, rpcUrl: "https://remote.example" }),
		).toThrow("RPC 配置无效");
	});
});
