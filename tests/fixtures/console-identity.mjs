import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { transformSync } from "esbuild";

const slots = [];
let cursor = 0;
let effects = [];
let changed = false;
const react = {
	createContext(initial) {
		const context = { current: initial };
		context.Provider = { context };
		return context;
	},
	useContext(context) {
		return context.current;
	},
	useState(initial) {
		const index = cursor++;
		if (!(index in slots))
			slots[index] = typeof initial === "function" ? initial() : initial;
		return [
			slots[index],
			(value) => {
				const next = typeof value === "function" ? value(slots[index]) : value;
				if (next !== slots[index]) {
					slots[index] = next;
					changed = true;
				}
			},
		];
	},
	useRef(initial) {
		const index = cursor++;
		if (!(index in slots)) slots[index] = { current: initial };
		return slots[index];
	},
	useEffect(callback, dependencies) {
		const index = cursor++;
		const previous = slots[index];
		if (
			!previous ||
			dependencies.some((item, position) => item !== previous[position])
		) {
			slots[index] = dependencies;
			effects.push(callback);
		}
	},
};
const switchWallet = process.argv[2] === "switch";
const navigatePages = process.argv[2] === "navigation";
let currentPath = "/console/billing";
const routeHistory = [currentPath];
let historyIndex = 0;
const router = {
	push(path) {
		currentPath = path;
		routeHistory.splice(++historyIndex, routeHistory.length, path);
		changed = true;
	},
	replace(path) {
		currentPath = path;
		routeHistory[historyIndex] = path;
		changed = true;
	},
	back() {
		currentPath = routeHistory[--historyIndex];
	},
};
const walletA = `0x${"11".repeat(20)}`;
const walletB = `0x${"22".repeat(20)}`;
let currentWallet = walletA;
const data = {
	viewer: { address: walletA, demo: false },
	network: {
		chainId: 1,
		asset: "ETH",
		mode: "evm",
		name: "Ethereum",
		ready: true,
		escrow: `0x${"33".repeat(20)}`,
	},
	listings: [],
	sessions: [],
	keys: [],
	requests: [],
	settlements: [],
	metrics: { claimable: "0", walletBalance: "0" },
};
let resolveConfirmation;
const confirmation = new Promise((resolve) => {
	resolveConfirmation = resolve;
});
const snapshot = { data, refetch: async () => ({ data }) };
const api = {
	token2api: new Proxy(
		{},
		{
			get(_target, name) {
				return {
					useQuery: () => (name === "snapshot" ? snapshot : {}),
					useMutation: () => ({
						mutateAsync: () =>
							name === "confirmSession" ? confirmation : Promise.resolve({}),
					}),
				};
			},
		},
	),
};
const placeholder = () => null;
function element(type, props) {
	if (type?.context) type.context.current = props.value;
	return { type, props };
}
const modules = {
	react,
	"react/jsx-runtime": {
		jsx: element,
		jsxs: element,
		Fragment: "fragment",
	},
	"@rainbow-me/rainbowkit": { ConnectButton: placeholder },
	"lucide-react": new Proxy({}, { get: () => placeholder }),
	"next/dynamic": () => placeholder,
	"next/image": placeholder,
	"next/link": placeholder,
	"next/navigation": {
		useRouter: () => router,
		useSelectedLayoutSegment: () => currentPath.split("/")[2] ?? null,
	},
	"~/app/_components/asset-glyph": { AssetGlyph: placeholder },
	"~/app/_components/chain-glyph": {
		ChainGlyph: placeholder,
		chainColor: () => "#000",
		chainLabel: () => "Ethereum",
	},
	"~/app/_components/console/chain-actions": {},
	"~/app/_components/console/format": {
		activeSession: () => true,
		onlineListings: () => 0,
		sameAddress: (a, b) => a?.toLowerCase() === b?.toLowerCase(),
	},
	"~/app/_components/console/overview-section": {
		OverviewSection: placeholder,
	},
	"~/app/_components/console/ui": { Badge: placeholder },
	"~/app/_components/wallet-provider": {
		useToken2ApiWallet: () => ({
			address: currentWallet,
			isConnected: true,
			getWallet: async () => ({}),
		}),
	},
	"~/shared/connector-distribution": {},
	"~/shared/money": { formatAmount: (value) => String(value) },
	"~/shared/network": {
		SETTLEMENT_CHAINS: [],
		networkMetadata: () => ({ nativeSymbol: "ETH" }),
	},
	"~/shared/settlement-asset": { isNativeAsset: () => true },
	"~/shared/ui-preview": { uiPreview: false },
	"~/trpc/react": { api },
};
const browserWindow = {
	location: {
		hash: "",
		get pathname() {
			return currentPath;
		},
	},
	addEventListener: () => {},
	removeEventListener: () => {},
	matchMedia: () => ({
		matches: true,
		addEventListener: () => {},
		removeEventListener: () => {},
	}),
	setTimeout: () => 0,
	clearTimeout: () => {},
	requestAnimationFrame: (callback) => callback(),
};
function loadSource(path) {
	const output = transformSync(fs.readFileSync(path, "utf8"), {
		loader: "tsx",
		format: "cjs",
		jsx: "automatic",
		target: "es2022",
	}).code;
	const module = { exports: {} };
	vm.runInNewContext(output, {
		module,
		exports: module.exports,
		require: (name) => {
			if (!(name in modules)) throw new Error(`Missing stub: ${name}`);
			return modules[name];
		},
		window: browserWindow,
		console,
	});
	return module.exports;
}
modules["~/app/_components/console/routes"] = loadSource(
	"src/app/_components/console/routes.ts",
);
const pageContent = loadSource("src/app/_components/console/page-content.tsx");
modules["~/app/_components/console/page-content"] = pageContent;
const root = loadSource(
	"src/app/_components/token2api-console.tsx",
).Token2ApiConsole;
function render() {
	let tree;
	let count = 0;
	do {
		changed = false;
		cursor = 0;
		effects = [];
		tree = root({ children: null });
		for (const effect of effects) effect();
		if (++count > 15) throw new Error("Render loop");
	} while (changed);
	return [
		tree,
		pageContent.ConsolePageContent({
			section: currentPath.split("/")[2] ?? "overview",
		}),
	];
}
function find(tree, predicate) {
	if (!tree || typeof tree !== "object") return undefined;
	if (Array.isArray(tree))
		return tree.map((value) => find(value, predicate)).find(Boolean);
	if (predicate(tree)) return tree;
	return find(tree.props?.children, predicate);
}
let tree = render();
assert.equal(
	find(tree, (node) => node.props?.["aria-current"] === "page").props.href,
	"/console/billing",
);
const billing = find(
	tree,
	(node) => typeof node.props?.onConfirm === "function",
);
assert.ok(billing);
billing.props.onConfirm(`0x${"44".repeat(32)}`);
currentWallet = switchWallet ? walletB : walletA;
data.viewer = { address: currentWallet, demo: false };
tree = render();
assert.equal(
	find(tree, (node) => typeof node.props?.onConfirm === "function").props.data
		.viewer.address,
	currentWallet,
);
resolveConfirmation({
	connection: {
		key: "AUDIT_ONLY_WALLET_A_KEY",
		base_url: "http://localhost/v1",
		model: "audit-model",
	},
});
for (let turn = 0; turn < 8; turn++) await Promise.resolve();
tree = render();
const keyView = find(
	tree,
	(node) => node.props?.newKey?.key === "AUDIT_ONLY_WALLET_A_KEY",
);
if (switchWallet) {
	assert.equal(
		keyView,
		undefined,
		"A late response must not expose the previous wallet key",
	);
} else {
	assert.ok(keyView, "The initiating wallet receives its one-time key");
	assert.equal(currentPath, "/console/keys");
	assert.equal(keyView.props.data.viewer.address, walletA);
	if (navigatePages) {
		keyView.props.navigate("lab");
		tree = render();
		let lab = find(
			tree,
			(node) => typeof node.props?.onPromptChange === "function",
		);
		lab.props.onPromptChange("Keep this draft while comparing resources.");
		lab.props.navigate("market");
		tree = render();
		assert.equal(currentPath, "/console/market");
		router.back();
		tree = render();
		lab = find(
			tree,
			(node) => typeof node.props?.onPromptChange === "function",
		);
		assert.equal(
			lab.props.prompt,
			"Keep this draft while comparing resources.",
		);
		lab.props.navigate("keys");
		tree = render();
		assert.ok(
			find(
				tree,
				(node) => node.props?.newKey?.key === "AUDIT_ONLY_WALLET_A_KEY",
			),
		);
	}
}
console.log("console identity scenario passed");
