"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import {
	ArrowUpRight,
	Blocks,
	CheckCheck,
	CircleHelp,
	ExternalLink,
	FlaskConical,
	Globe2,
	KeyRound,
	Layers3,
	LayoutDashboard,
	LoaderCircle,
	type LucideIcon,
	Menu,
	Plus,
	RefreshCw,
	Server,
	ShieldCheck,
	Wallet,
	X,
} from "lucide-react";
import dynamic from "next/dynamic";
import Image from "next/image";
import Link from "next/link";
import { useRouter, useSelectedLayoutSegment } from "next/navigation";
import {
	type FormEvent,
	type ReactNode,
	useEffect,
	useRef,
	useState,
} from "react";
import { AssetGlyph } from "~/app/_components/asset-glyph";
import { BrandLogo } from "~/app/_components/brand-logo";
import {
	ChainGlyph,
	chainColor,
	chainLabel,
} from "~/app/_components/chain-glyph";
import {
	type ChainContext,
	selfCloseSession,
	sendPrepaidTransfer,
	withdrawBalance,
} from "~/app/_components/console/chain-actions";
import type { ConnectorDraft } from "~/app/_components/console/connector-modals";
import { type Section, sameAddress } from "~/app/_components/console/format";
import type { ChatMessage } from "~/app/_components/console/lab-section";
import { OverviewSection } from "~/app/_components/console/overview-section";
import { ConsolePagesContext } from "~/app/_components/console/page-content";
import {
	consoleRoutes,
	isConsoleSection,
} from "~/app/_components/console/routes";
import { Badge, Loading } from "~/app/_components/console/ui";
import { useToken2ApiWallet } from "~/app/_components/wallet-provider";
import { connectorStartCommand } from "~/shared/connector-distribution";
import { modelKeyInput } from "~/shared/model-routing";
import { parseMicroAmount, formatAmount as usd } from "~/shared/money";
import {
	DEFAULT_NETWORK,
	networkMetadata,
	SETTLEMENT_CHAINS,
} from "~/shared/network";
import { isNativeAsset } from "~/shared/settlement-asset";
import type {
	BuyerConnection,
	RefundView,
	SessionView,
} from "~/shared/token2api";
import { previewModels, previewSnapshot, uiPreview } from "~/shared/ui-preview";
import { api } from "~/trpc/react";

// Overview is the landing section; every other section and all dialogs load on demand.
const loadMarket = () =>
	import("~/app/_components/console/market-section").then(
		(module) => module.MarketSection,
	);
const loadPool = () =>
	import("~/app/_components/console/pool-section").then(
		(module) => module.PoolSection,
	);
const loadLab = () =>
	import("~/app/_components/console/lab-section").then(
		(module) => module.LabSection,
	);
const loadBilling = () =>
	import("~/app/_components/console/billing-section").then(
		(module) => module.BillingSection,
	);
const loadKeys = () =>
	import("~/app/_components/console/keys-section").then(
		(module) => module.KeysSection,
	);
const loadSessionModals = () =>
	import("~/app/_components/console/session-modals");
const loadConnectorModals = () =>
	import("~/app/_components/console/connector-modals");
const PrepaidAccountPanel = dynamic(() =>
	import("~/app/_components/console/prepaid-account").then(
		(module) => module.PrepaidAccountPanel,
	),
);
const sectionLoading = () => <Loading label="正在打开工作区…" />;
const MarketSection = dynamic(loadMarket, { loading: sectionLoading });
const PoolSection = dynamic(loadPool, { loading: sectionLoading });
const LabSection = dynamic(loadLab, { loading: sectionLoading });
const BillingSection = dynamic(loadBilling, { loading: sectionLoading });
const KeysSection = dynamic(loadKeys, { loading: sectionLoading });
const RefundModal = dynamic(() =>
	loadSessionModals().then((module) => module.RefundModal),
);
const WithdrawModal = dynamic(() =>
	loadSessionModals().then((module) => module.WithdrawModal),
);
const KeyModal = dynamic(() =>
	loadSessionModals().then((module) => module.KeyModal),
);
const ConnectorSetupModal = dynamic(() =>
	loadConnectorModals().then((module) => module.ConnectorSetupModal),
);
const ConnectorLaunchModal = dynamic(() =>
	loadConnectorModals().then((module) => module.ConnectorLaunchModal),
);
const ListingModal = dynamic(() =>
	loadConnectorModals().then((module) => module.ListingModal),
);
const deferredChunks = [
	loadMarket,
	loadPool,
	loadLab,
	loadBilling,
	loadKeys,
	loadSessionModals,
	loadConnectorModals,
];

const navigation = [
	{ id: "overview", label: "概览", icon: LayoutDashboard },
	{ id: "market", label: "模型市场", icon: Globe2 },
	{ id: "pool", label: "我的资源", icon: Layers3 },
	{ id: "lab", label: "调用实验室", icon: FlaskConical },
	{ id: "billing", label: "账单与结算", icon: Blocks },
	{ id: "keys", label: "API 密钥", icon: KeyRound },
] satisfies { id: Section; label: string; icon: LucideIcon }[];
export function Token2ApiConsole({ children }: { children: ReactNode }) {
	const router = useRouter();
	const segment = useSelectedLayoutSegment();
	const section = isConsoleSection(segment) ? segment : "overview";
	const previousSectionRef = useRef(section);
	const {
		getWallet,
		address: connectedAddress,
		isConnected,
	} = useToken2ApiWallet();
	const [billingTarget, setBillingTarget] = useState(false);
	const [mobileOpen, setMobileOpen] = useState(false);
	const menuButtonRef = useRef<HTMLButtonElement>(null);
	const sidebarRef = useRef<HTMLElement>(null);
	const headingRef = useRef<HTMLHeadingElement>(null);
	const [busy, setBusy] = useState<string | null>(null);
	const busyRef = useRef(false);
	const [error, setError] = useState<string | null>(null);
	const [notice, setNotice] = useState<string | null>(null);
	const [listingModal, setListingModal] = useState(false);
	const [keyModal, setKeyModal] = useState(false);
	const [refundSession, setRefundSession] = useState<SessionView | null>(null);
	const [refundInfo, setRefundInfo] = useState<RefundView | null>(null);
	const [withdrawModal, setWithdrawModal] = useState(false);
	const [keyName, setKeyName] = useState("My application");
	const [allowedModels, setAllowedModels] = useState<string[]>([]);
	const [selectedKey, setSelectedKey] = useState("");
	const [selectedModel, setSelectedModel] = useState("");
	const [newConnector, setNewConnector] = useState<ConnectorDraft | null>(null);
	const [launch, setLaunch] = useState<{
		id: string;
		token: string;
		command: string;
	} | null>(null);
	const launchCommand =
		launch?.id === newConnector?.id && launch?.token === newConnector?.token
			? (launch?.command ?? null)
			: null;
	const [newKey, setNewKey] = useState<BuyerConnection | null>(null);
	const [prompt, setPrompt] = useState(
		"用三句话解释 Token2API 的链上结算流程。",
	);
	const [messages, setMessages] = useState<ChatMessage[]>([]);
	const [conversationId, setConversationId] = useState(() => "");
	const [copied, setCopied] = useState(false);
	const snapshot = api.token2api.snapshot.useQuery(
		{ gatewayOnly: true },
		{ refetchInterval: 15_000 },
	);
	const createLocalDraft = api.token2api.createLocalDraft.useMutation();
	const createConnectorLaunch =
		api.token2api.createConnectorLaunch.useMutation();
	const publishLocalDraft = api.token2api.publishLocalDraft.useMutation();
	const rotateConnector = api.token2api.rotateConnector.useMutation();
	const createListing = api.token2api.createListing.useMutation();
	const toggleListing = api.token2api.toggleListing.useMutation();
	const confirmSession = api.token2api.confirmSession.useMutation();
	const createKey = api.token2api.createKey.useMutation();
	const revokeKey = api.token2api.revokeKey.useMutation();
	const chat = api.token2api.modelChat.useMutation();
	const updateModels = api.token2api.updateKeyModels.useMutation();
	const prepareTransfer = api.token2api.preparePrepaidTransfer.useMutation();
	const settle = api.token2api.settle.useMutation();
	const requestRefund = api.token2api.requestRefund.useMutation();
	const withdraw = api.token2api.withdraw.useMutation();
	const data = uiPreview ? previewSnapshot : snapshot.data;
	const asset = data?.network.asset ?? DEFAULT_NETWORK.asset;
	const nativeSymbol = data ? networkMetadata(data.network).nativeSymbol : "";
	const viewer = data?.viewer;
	const catalogQuery = api.token2api.modelCatalog.useQuery(undefined, {
		enabled: !uiPreview,
		refetchInterval: 15_000,
	});
	const catalog = uiPreview ? previewModels : (catalogQuery.data ?? []);
	const prepaidQuery = api.token2api.prepaidAccount.useQuery(
		{ address: viewer?.address ?? `0x${"00".repeat(20)}` },
		{ enabled: !!viewer && !uiPreview, refetchInterval: 15_000, retry: false },
	);
	const modelKeys =
		data?.keys.filter((key) => !key.revoked && key.sessionId === null) ?? [];
	const labKey =
		modelKeys.find((key) => key.id === selectedKey) ?? modelKeys[0];
	const labModels = catalog.filter((model) =>
		labKey?.models.includes(model.id),
	);
	const labModel =
		labModels.find((model) => model.id === selectedModel)?.id ??
		labModels[0]?.id ??
		"";

	const refundQuery = api.token2api.refundStatus.useQuery(
		{ sessionId: refundSession?.id ?? `0x${"00".repeat(32)}` },
		{
			enabled: !!refundSession && !!refundInfo && !!viewer,
			retry: false,
			refetchInterval: refundInfo?.status === "AVAILABLE" ? false : 3000,
		},
	);
	const currentRefund = refundQuery.data ?? refundInfo;
	const connectionIdentity = viewer?.demo
		? "demo"
		: `${connectedAddress?.toLowerCase() ?? "none"}:${isConnected ? "connected" : "disconnected"}`;
	const identity = `${viewer?.demo ? "demo" : "wallet"}:${viewer?.address ?? "guest"}:${connectionIdentity}`;
	const identityRef = useRef(identity);
	const identityGeneration = useRef(0);
	if (identityRef.current !== identity) {
		identityRef.current = identity;
		identityGeneration.current += 1;
	}
	useEffect(() => {
		// A new authenticated identity never inherits another wallet's private UI state.
		void identity;
		setNewKey(null);
		setRefundSession(null);
		setRefundInfo(null);
		setWithdrawModal(false);
		setNewConnector(null);
		setLaunch(null);
		setMessages([]);
		setSelectedKey("");
		setSelectedModel("");
		setAllowedModels([]);
		setConversationId("");
		setKeyModal(false);
		setListingModal(false);
		setError(null);
		setNotice(null);
		setBusy(null);
		busyRef.current = false;
	}, [identity]);
	useEffect(() => {
		// Warm deferred chunks after first paint so later navigation does not wait on the network.
		const timeout = window.setTimeout(() => {
			for (const load of deferredChunks) void load();
		}, 1500);
		return () => window.clearTimeout(timeout);
	}, []);
	const walletMismatch =
		!!viewer &&
		!viewer.demo &&
		(!isConnected || !sameAddress(connectedAddress, viewer.address));

	const previousLab = useRef({ keyId: labKey?.id, model: labModel });
	useEffect(() => {
		if (
			previousLab.current.keyId === labKey?.id &&
			previousLab.current.model === labModel
		)
			return;
		previousLab.current = { keyId: labKey?.id, model: labModel };
		setMessages([]);
		setConversationId("");
	}, [labKey?.id, labModel]);
	const closeMobileMenu = () => {
		setMobileOpen(false);
		window.requestAnimationFrame(() => menuButtonRef.current?.focus());
	};
	useEffect(() => {
		const target = window.location.hash.slice(1);
		if (window.location.pathname === "/console" && isConsoleSection(target)) {
			router.replace(consoleRoutes[target].href, { scroll: false });
		}
	}, [router]);
	useEffect(() => {
		if (previousSectionRef.current === section) return;
		previousSectionRef.current = section;
		setMobileOpen(false);
		setError(null);
		window.requestAnimationFrame(() => headingRef.current?.focus());
	}, [section]);
	useEffect(() => {
		const desktop = window.matchMedia("(min-width: 701px)");
		const onResize = () => {
			if (desktop.matches) setMobileOpen(false);
		};
		desktop.addEventListener("change", onResize);
		return () => desktop.removeEventListener("change", onResize);
	}, []);
	useEffect(() => {
		if (!mobileOpen) return;
		const previousOverflow = document.body.style.overflow;
		document.body.style.overflow = "hidden";
		const onEscape = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				setMobileOpen(false);
				window.requestAnimationFrame(() => menuButtonRef.current?.focus());
				return;
			}
			if (event.key !== "Tab" || !sidebarRef.current) return;
			const controls = Array.from(
				sidebarRef.current.querySelectorAll<HTMLElement>(
					"a, button:not([disabled])",
				),
			);
			const first = controls[0];
			const last = controls.at(-1);
			if (!first || !last) return;
			if (!sidebarRef.current.contains(document.activeElement)) {
				event.preventDefault();
				(event.shiftKey ? last : first).focus();
			} else if (event.shiftKey && document.activeElement === first) {
				event.preventDefault();
				last.focus();
			} else if (!event.shiftKey && document.activeElement === last) {
				event.preventDefault();
				first.focus();
			}
		};
		window.addEventListener("keydown", onEscape);
		const focusTimeout = window.setTimeout(() => {
			if (!sidebarRef.current?.contains(document.activeElement)) {
				sidebarRef.current
					?.querySelector<HTMLAnchorElement>(".nav-item.active")
					?.focus();
			}
		}, 220);
		return () => {
			document.body.style.overflow = previousOverflow;
			window.clearTimeout(focusTimeout);
			window.removeEventListener("keydown", onEscape);
		};
	}, [mobileOpen]);
	const prepareNavigation = (value: Section) => {
		setError(null);
		setBillingTarget(false);
		setMobileOpen(false);
		if (value === section) {
			window.requestAnimationFrame(() => headingRef.current?.focus());
		}
	};
	const navigate = (value: Section) => {
		prepareNavigation(value);
		if (value !== section) {
			router.push(consoleRoutes[value].href, { scroll: false });
		}
	};
	const run = async (
		name: string,
		action: (isCurrent: () => boolean) => Promise<void>,
	) => {
		if (busy || busyRef.current) return;
		if (walletMismatch && name !== "login" && name !== "logout") {
			setError("钱包与登录身份不一致，请在钱包菜单中重新连接并签名登录。");
			return;
		}
		const generation = identityGeneration.current;
		const isCurrent = () => identityGeneration.current === generation;
		busyRef.current = true;
		setBusy(name);
		setError(null);
		setNotice(null);
		try {
			await action(isCurrent);
		} catch (cause) {
			if (!isCurrent()) return;
			setError(
				cause instanceof Error ? cause.message : "操作失败，请稍后重试。",
			);
		} finally {
			await snapshot.refetch();
			if (isCurrent() && viewer && !uiPreview) await prepaidQuery.refetch();
			if (isCurrent()) {
				setBusy(null);
				busyRef.current = false;
			}
		}
	};
	const chainContext = (isCurrent: () => boolean): ChainContext | null =>
		data && viewer
			? { getWallet, network: data.network, address: viewer.address, isCurrent }
			: null;
	const resetConversation = () => {
		setMessages([]);
		setConversationId("");
		setError(null);
		chat.reset();
	};
	const submitChat = (event: FormEvent) => {
		event.preventDefault();
		if (!prompt.trim() || !labKey || !labModel) return;
		void run("chat", async (isCurrent) => {
			const content = prompt.trim();
			const previousReply = messages.at(-1);
			const history =
				previousReply?.role === "assistant" &&
				previousReply.finishReason !== "stop"
					? []
					: messages;
			const nextMessages: ChatMessage[] = [
				...history,
				{ id: crypto.randomUUID(), role: "user", content },
			];
			const currentConversation = history.length
				? conversationId
				: crypto.randomUUID();
			if (uiPreview) throw new Error("UI 预览不调用真实模型或扣费。");
			const result = await chat.mutateAsync({
				keyId: labKey.id,
				model: labModel,
				messages: nextMessages.slice(-19).map(({ role, content: text }) => ({
					role,
					content: text,
				})),
				maxTokens: 512,
				conversationId: currentConversation,
				idempotencyKey: crypto.randomUUID(),
			});
			if (!isCurrent()) return;
			setConversationId(currentConversation);
			setMessages([
				...nextMessages,
				{
					id: result.id,
					role: "assistant",
					content: result.text,
					finishReason: result.finishReason,
					meta: `${result.inputTokens} 输入 · ${result.outputTokens} 输出 · ${usd(result.cost, true)} ${asset} · ${result.usageSource}`,
				},
			]);
			if (result.finishReason !== "stop")
				setNotice(
					result.finishReason === "length"
						? "回复已达到输出上限。下一条消息会开启新对话，避免将不完整回复当成上下文。"
						: "上游过滤了这条回复。下一条消息会开启新对话。",
				);
			setPrompt("");
		});
	};
	const submitKey = (event: FormEvent) => {
		event.preventDefault();
		void run("key", async (isCurrent) => {
			const input = modelKeyInput.parse({
				name: keyName,
				models: allowedModels,
			});
			if (uiPreview) throw new Error("UI 预览不创建真实 Key。");
			const result = await createKey.mutateAsync(input);
			if (!isCurrent()) return;
			setNewKey(result);
			setKeyModal(false);
			setNotice("Key 已创建，请保存完整密钥；模型权限可随时调整。");
		});
	};
	const submitListing = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		const form = new FormData(event.currentTarget);
		void run("listing", async (isCurrent) => {
			const common = {
				name: String(form.get("name")),
				description: String(form.get("description")),
				kind: "gateway" as const,
			};
			if (form.has("local")) {
				const result = await createLocalDraft.mutateAsync({
					...common,
					concurrency: 1,
				});
				if (!isCurrent()) return;
				setNewConnector({ ...result, model: "" });
			} else {
				await createListing.mutateAsync({
					...common,
					model: String(form.get("model")),
					inputRate: parseMicroAmount(String(form.get("inputRate"))),
					outputRate: parseMicroAmount(String(form.get("outputRate"))),
					concurrency: Number(form.get("concurrency")),
					baseUrl: String(form.get("baseUrl")),
					apiKey: String(form.get("apiKey")),
					...(String(form.get("proxyUrl") ?? "").trim()
						? {
								proxy: {
									url: String(form.get("proxyUrl")).trim(),
									...(form.get("proxyUsername")
										? {
												username: String(form.get("proxyUsername")),
												password: String(form.get("proxyPassword") ?? ""),
											}
										: {}),
								},
							}
						: {}),
				});
			}
			if (!isCurrent()) return;
			setListingModal(false);
			setNotice(
				form.has("local")
					? "连接草稿已创建。启动连接器后自动读取模型，再选择模型与报价上架。"
					: "资源已接入。凭证仅保存在服务端，不会展示给调用方。",
			);
		});
	};
	const doWithdraw = (recipient?: string) =>
		void run("withdraw", async (isCurrent) => {
			const context = chainContext(isCurrent);
			if (!context) return;
			const result = await withdraw.mutateAsync();
			if (!isCurrent()) return;
			if (result.mode === "wallet") await withdrawBalance(context, recipient);
			if (!isCurrent()) return;
			setWithdrawModal(false);
			setNotice("提现交易已确认，余额已转入收款钱包。");
		});
	const openWithdraw = () => {
		if (busy) return;
		if (isNativeAsset(asset) && !viewer?.demo) {
			setRefundSession(null);
			setRefundInfo(null);
			setError(null);
			setWithdrawModal(true);
		} else {
			doWithdraw();
		}
	};
	const selfClose = (session: SessionView) =>
		void run("self-close", async (isCurrent) => {
			const context = chainContext(isCurrent);
			if (!context) return;
			setNotice(
				await selfCloseSession(context, session.id, session.fundingSource),
			);
		});
	const copy = async (value: string) => {
		try {
			await navigator.clipboard.writeText(value);
			setCopied(true);
			setNotice("内容已复制到剪贴板。");
			window.setTimeout(() => setCopied(false), 2000);
		} catch {
			setError("浏览器未允许剪贴板访问，请手动复制。");
		}
	};
	const copyConnectorStart = () => {
		if (!newConnector) return;
		void run("connector-start", async (isCurrent) => {
			const result = await createConnectorLaunch.mutateAsync({
				id: newConnector.id,
			});
			if (!isCurrent()) return;
			const command = connectorStartCommand(
				window.location.origin,
				newConnector.model || undefined,
				result.code,
			);
			setLaunch({ id: newConnector.id, token: newConnector.token, command });
			await copy(command);
		});
	};
	const resetConnector = (id: string) =>
		void run("connector", async (isCurrent) => {
			const result = await rotateConnector.mutateAsync({ id });
			if (isCurrent()) setNewConnector({ ...result, model: "" });
		});
	const closeConnector = () => {
		setNewConnector(null);
		setLaunch(null);
	};
	const closeRefund = () => {
		setRefundSession(null);
		setRefundInfo(null);
	};
	const openKey = (models: string[] = []) => {
		setError(null);
		setAllowedModels(models);
		setKeyModal(true);
	};
	const transferPrepaid = async (
		kind: "deposit" | "withdraw",
		amount: number,
	) => {
		let completed = false;
		await run("prepaid", async (isCurrent) => {
			const context = chainContext(isCurrent);
			if (!context || uiPreview)
				throw new Error("请连接真实钱包后操作预付余额。");
			const plan = await prepareTransfer.mutateAsync({ kind, amount });
			if (!isCurrent()) return;
			await sendPrepaidTransfer(context, plan, amount, kind);
			if (!isCurrent()) return;
			await prepaidQuery.refetch();
			completed = true;
			setNotice(
				kind === "deposit"
					? "充值已确认，所有模型 Key 共用此余额。"
					: "未用预付余额已提取，请在钱包核对到账。",
			);
		});
		return completed;
	};
	const accountPanel = data ? (
		<PrepaidAccountPanel
			account={uiPreview ? null : (prepaidQuery.data ?? null)}
			busy={!!busy}
			error={error}
			key={`prepaid:${identity}`}
			loading={prepaidQuery.isLoading}
			network={data.network}
			onOpen={() => setError(null)}
			onRetry={() => void prepaidQuery.refetch()}
			onTransfer={transferPrepaid}
			preview={uiPreview}
			queryError={prepaidQuery.error?.message ?? null}
			signedIn={!!viewer}
		/>
	) : null;
	const pages: Record<Section, ReactNode> | null = data
		? {
				overview: (
					<OverviewSection
						data={data}
						nativeSymbol={nativeSymbol}
						navigate={navigate}
					/>
				),
				market: (
					<MarketSection
						asset={asset}
						busy={!!busy}
						error={catalogQuery.error?.message ?? null}
						loading={!uiPreview && catalogQuery.isLoading}
						models={catalog}
						onCreateKey={openKey}
						onRetry={() => void catalogQuery.refetch()}
						signedIn={!!viewer}
					/>
				),
				pool: (
					<PoolSection
						busy={!!busy}
						data={data}
						navigate={navigate}
						onConnect={(item) => {
							if (item.status === "DISCOVERING")
								setNewConnector({ id: item.id, token: "", model: "" });
							else
								void run("connector", async (isCurrent) => {
									const result = await rotateConnector.mutateAsync({
										id: item.id,
									});
									if (isCurrent())
										setNewConnector({ ...result, model: item.model });
								});
						}}
						onToggle={(item) =>
							void run("toggle", async () => {
								await toggleListing.mutateAsync({
									id: item.id,
									enabled: !item.enabled,
								});
								setNotice(
									item.enabled
										? "资源已暂停，停止受理新调用。"
										: "资源已上架，请在列表核对连接状态。",
								);
							})
						}
					/>
				),
				lab: (
					<LabSection
						asset={asset}
						balance={prepaidQuery.data?.available ?? null}
						busy={busy}
						error={error ?? chat.error?.message ?? null}
						keyId={labKey?.id ?? ""}
						keys={modelKeys}
						messages={messages}
						modelId={labModel}
						models={labModels}
						navigate={navigate}
						onNewConversation={resetConversation}
						onOpenBilling={() => {
							navigate("billing");
							setBillingTarget(true);
						}}
						onPromptChange={setPrompt}
						onSelectKey={(value) => {
							setSelectedKey(value);
							resetConversation();
						}}
						onSelectModel={(value) => {
							setSelectedModel(value);
							resetConversation();
						}}
						onSubmit={submitChat}
						prompt={prompt}
					/>
				),
				billing: (
					<>
						{accountPanel}
						<BillingSection
							busy={!!busy}
							data={data}
							focusRequests={billingTarget}
							onConfirm={(id) =>
								void run("confirm", async (isCurrent) => {
									const confirmed = await confirmSession.mutateAsync({
										id,
									});
									if (!isCurrent()) return;
									if (confirmed.connection) {
										setNewKey(confirmed.connection);
										navigate("keys");
									}
									setNotice("链上预算已确认，可以开始调用或创建 API 密钥。");
								})
							}
							onFocused={() => setBillingTarget(false)}
							onRefund={(session) => {
								setError(null);
								setRefundSession(session);
								setRefundInfo(null);
							}}
							onSelfClose={selfClose}
							onSettle={(id) =>
								void run("settle", async () => {
									await settle.mutateAsync({ sessionId: id });
									setNotice("该会话的待结算费用已提交链上。");
								})
							}
							onWithdraw={openWithdraw}
						/>
					</>
				),
				keys: (
					<>
						{accountPanel}
						<KeysSection
							busy={!!busy}
							copied={copied}
							data={data}
							error={error}
							key={identity}
							model={labModel || newKey?.model}
							models={catalog}
							modelsError={catalogQuery.error?.message ?? null}
							modelsLoading={!uiPreview && catalogQuery.isLoading}
							navigate={navigate}
							newKey={newKey}
							onCopy={(value) => void copy(value)}
							onCreateKey={() => openKey()}
							onEditOpen={() => setError(null)}
							onRetryModels={() => void catalogQuery.refetch()}
							onRevoke={(id) =>
								void run("revoke", async () => {
									await revokeKey.mutateAsync({ id });
									setNewKey(null);
									setNotice("密钥已撤销，不能再用于新请求。");
								})
							}
							onUpdateModels={async (id, models) => {
								let updated = false;
								await run("key-models", async (isCurrent) => {
									await updateModels.mutateAsync({ id, models });
									if (isCurrent()) {
										updated = true;
										setNotice("Key 的模型权限已更新。");
									}
								});
								return updated;
							}}
						/>
					</>
				),
			}
		: null;
	const headingAction =
		section === "overview" ? (
			<div className="page-actions">
				<button
					className="button"
					disabled={snapshot.isFetching}
					onClick={() => void snapshot.refetch()}
					type="button"
				>
					<RefreshCw className={snapshot.isFetching ? "spin" : ""} size={12} />
					刷新数据
				</button>
				{data?.network.escrow && (
					<button
						className="button primary"
						onClick={() =>
							navigate(
								data.keys.some((key) => !key.revoked && !key.sessionId)
									? "lab"
									: "keys",
							)
						}
						type="button"
					>
						{data.keys.some((key) => !key.revoked && !key.sessionId)
							? "继续调用"
							: "创建 API Key"}
					</button>
				)}
			</div>
		) : section === "pool" ? (
			<button
				className="button primary"
				disabled={!viewer || !data?.network.escrow || !!busy}
				onClick={() => {
					setError(null);
					setListingModal(true);
				}}
				type="button"
			>
				<Plus size={13} />
				接入资源
			</button>
		) : section === "keys" ? (
			<button
				className="button primary"
				disabled={!viewer || !data?.network.escrow || !!busy}
				onClick={() => openKey()}
				type="button"
			>
				<Plus size={13} />
				创建密钥
			</button>
		) : null;

	return (
		<div className="app-shell">
			<Link
				className="skip-link"
				href="#console-main"
				onNavigate={() => headingRef.current?.focus()}
			>
				跳到主要内容
			</Link>
			<button
				aria-hidden={!mobileOpen}
				aria-label="关闭导航菜单"
				className={`screen-overlay ${mobileOpen ? "is-open" : ""}`}
				onClick={closeMobileMenu}
				tabIndex={mobileOpen ? 0 : -1}
				type="button"
			/>
			<aside
				aria-label="工作区导航"
				className={`sidebar ${mobileOpen ? "is-open" : ""}`}
				ref={sidebarRef}
			>
				<a aria-label="Token2API 首页" className="brand" href="/">
					<BrandLogo tone="dark" />
				</a>
				<button
					aria-label="关闭导航菜单"
					className="mobile-close"
					onClick={closeMobileMenu}
					type="button"
				>
					<X size={18} />
				</button>
				<span className="sidebar-caption">工作台</span>
				<nav aria-label="主导航">
					{navigation.map(({ id, label, icon: Icon }) => (
						<Link
							aria-current={section === id ? "page" : undefined}
							className={`nav-item ${section === id ? "active" : ""}`}
							href={consoleRoutes[id].href}
							key={id}
							onNavigate={() => prepareNavigation(id)}
							scroll={false}
						>
							<Icon size={17} strokeWidth={1.6} />
							<span>{label}</span>
							{id === "market" && data && (
								<span className="nav-count">
									{catalog.filter((model) => model.available).length}
								</span>
							)}
						</Link>
					))}
				</nav>
				<div className="sidebar-bottom">
					<div className="supported-chain-directory">
						<span className="sidebar-caption">
							支持网络 <small>{SETTLEMENT_CHAINS.length} EVM</small>
						</span>
						<div>
							{SETTLEMENT_CHAINS.map((chain) => (
								<span key={chain.id} title={chain.name}>
									<i style={{ background: chainColor(chain.id) }} />
									{chainLabel(chain.id, chain.name)}
								</span>
							))}
						</div>
					</div>
					<div className="network-panel">
						<div className="network-title">
							<span
								className={`status-dot ${data?.network.ready ? "" : "warn"}`}
							/>
							{data?.network.escrow ? data.network.name : "结算网络未配置"}
						</div>
						<p>
							{data?.network.mode === "local"
								? "本地测试资产"
								: data?.network.escrow
									? `${asset} · ${data.network.ready ? "结算服务可用" : "结算服务暂不可用"}`
									: "等待市场开通"}
						</p>
					</div>
					<div className="sidebar-links">
						<a
							href="https://github.com/OS-Lihua/token2api"
							rel="noreferrer"
							target="_blank"
						>
							GitHub <ArrowUpRight size={9} style={{ display: "inline" }} />
						</a>
						<a href="/api/v1/openapi.json" rel="noreferrer" target="_blank">
							API 规范 <ExternalLink size={9} style={{ display: "inline" }} />
						</a>
					</div>
				</div>
			</aside>
			<div className="main-shell" inert={mobileOpen}>
				<header className="topbar">
					<button
						aria-expanded={mobileOpen}
						aria-label="打开导航菜单"
						className="mobile-menu"
						onClick={() => setMobileOpen(true)}
						ref={menuButtonRef}
						type="button"
					>
						<Menu size={21} />
					</button>
					<div className="breadcrumb">
						<strong>{consoleRoutes[section].title}</strong>
					</div>
					<div className="topbar-actions">
						<a className="text-link" href="/admin">
							管理后台
						</a>
						<span
							className="topbar-status"
							title={
								data?.network.ready
									? `${data.network.name} · ${asset} 结算`
									: "结算服务暂不可用"
							}
						>
							<span
								className={`status-dot ${data?.network.ready ? "" : "warn"}`}
							/>
							{data?.network.escrow
								? `${data.network.name} · ${asset}`
								: "结算网络未配置"}
						</span>
						<div className="wallet-connect">
							{uiPreview ? (
								<span className="demo-pill">UI 预览</span>
							) : (
								<ConnectButton
									accountStatus="address"
									chainStatus="icon"
									label="连接钱包"
									showBalance={false}
								/>
							)}
						</div>
					</div>
				</header>
				<main className="content" id="console-main">
					<div
						className={`page-heading ${section === "overview" ? "overview-heading" : ""}`}
					>
						<div>
							<h1 ref={headingRef} tabIndex={-1}>
								{consoleRoutes[section].title}
							</h1>
							<p className="workspace-description">
								{consoleRoutes[section].description}
							</p>
						</div>
						{headingAction}
					</div>
					{data?.network.escrow && (
						<section aria-label="当前结算市场" className="market-context">
							<div className="market-context-network">
								<ChainGlyph
									className="console-chain-glyph"
									id={data.network.chainId}
								/>
								<div>
									<span>当前网络</span>
									<strong>{data.network.name}</strong>
								</div>
							</div>
							<div>
								<span>结算资产</span>
								<strong className="market-context-asset">
									<AssetGlyph size={16} symbol={asset} />
									{asset}
								</strong>
							</div>
							<div>
								<span>网络手续费</span>
								<strong>{nativeSymbol}</strong>
							</div>
							<Badge tone={data.network.ready ? "green" : "warn"}>
								{data.network.ready ? "结算可用" : "结算待就绪"}
							</Badge>
						</section>
					)}
					{error && (
						<div className="notice error" role="alert">
							<CircleHelp size={14} />
							<span>{error}</span>
							<button
								aria-label="关闭错误提示"
								onClick={() => setError(null)}
								type="button"
							>
								<X size={13} />
							</button>
						</div>
					)}
					{busy && busy !== "chat" && (
						<div className="notice info" role="status">
							<LoaderCircle className="spin" size={16} />
							<span>正在处理操作，请等待结果。</span>
						</div>
					)}
					{notice && (
						<div className="notice" role="status">
							<CheckCheck size={14} />
							<span>{notice}</span>
							<button
								aria-label="关闭通知"
								onClick={() => setNotice(null)}
								type="button"
							>
								<X size={13} />
							</button>
						</div>
					)}
					{data && snapshot.isError && (
						<div className="notice error" role="alert">
							<CircleHelp size={16} />
							<span>
								数据刷新失败，当前显示上次读取的记录。金额与操作结果请刷新后再核对。
							</span>
							<button
								className="text-link"
								disabled={snapshot.isFetching}
								onClick={() => void snapshot.refetch()}
								type="button"
							>
								重新加载
							</button>
						</div>
					)}
					{walletMismatch ? (
						<div className="loading-screen">
							<ShieldCheck size={28} />
							<span>请用当前钱包完成签名登录后继续。</span>
						</div>
					) : !data ? (
						<div className="loading-screen">
							{snapshot.isError ? (
								<>
									<Server size={28} strokeWidth={1.4} />
									<span>暂时无法连接，请稍后重试。</span>
									<button
										className="button"
										onClick={() => void snapshot.refetch()}
										type="button"
									>
										重新连接
									</button>
								</>
							) : (
								<>
									<LoaderCircle className="spin" size={25} />
									<span>正在连接资源网络…</span>
								</>
							)}
						</div>
					) : !data.network.escrow ? (
						<div className="market-empty">
							<div aria-hidden="true" className="market-empty-art">
								<span>
									<Layers3 size={23} />
								</span>
								<i className="market-empty-line" />
								<div>
									<Image alt="" height={44} src="/icon.svg" width={44} />
								</div>
								<i className="market-empty-line" />
								<span>
									<Wallet size={23} />
								</span>
							</div>
							<span className="market-empty-label">多链结算工作台</span>
							<h2>结算市场待开通</h2>
							<p>
								当前尚无可用的结算配置。开通后可查看资源报价、调用预算与结算账单。
							</p>
							<div className="market-empty-assets">
								<span>
									<AssetGlyph symbol="native" />
									原生代币
								</span>
								<span>
									<AssetGlyph symbol="USDT" />
									USDT
								</span>
								<span>
									<AssetGlyph symbol="USDC" />
									USDC
								</span>
							</div>
							<button
								className="button"
								onClick={() => void snapshot.refetch()}
								type="button"
							>
								刷新市场状态
							</button>
						</div>
					) : (
						<>
							{!data.network.ready && (
								<div className="notice info">
									<Server size={14} />
									<span>
										{uiPreview
											? "UI 预览 · 当前为模拟资源，未连接数据库或链。调用和保存操作不可用。"
											: "链上服务未就绪，暂时无法锁定预算、结算或提现。"}
									</span>
								</div>
							)}
							{!viewer && section !== "overview" && (
								<div className="notice info">
									<Wallet size={14} />
									<span>连接钱包并签名登录后开始使用。</span>
								</div>
							)}
							<ConsolePagesContext.Provider value={pages}>
								{children}
							</ConsolePagesContext.Provider>
						</>
					)}
				</main>
			</div>
			{!!data?.network.escrow && (
				<>
					{refundSession && data && !walletMismatch && (
						<RefundModal
							busy={busy}
							claimable={data.metrics.claimable}
							error={error}
							nativeSymbol={nativeSymbol}
							network={data.network}
							onClose={closeRefund}
							onRequest={() =>
								void run("refund", async (isCurrent) => {
									const result = await requestRefund.mutateAsync({
										sessionId: refundSession.id,
									});
									if (isCurrent()) {
										setRefundInfo(result);
										setNotice(
											result.status === "AVAILABLE"
												? result.destination === "prepaid"
													? "未用预留已退回统一预付账户，可继续调用或提取。"
													: "退款已可提取，请在钱包确认提现。"
												: result.destination === "prepaid"
													? "本次预留正在结算或核对，完成后退回预付账户。"
													: "退款申请已保存，处理期间停止此会话的新调用。",
										);
									}
								})
							}
							onWithdraw={openWithdraw}
							refund={currentRefund}
							session={refundSession}
						/>
					)}
					{withdrawModal && data && viewer && !walletMismatch && (
						<WithdrawModal
							address={viewer.address}
							busy={busy}
							claimable={data.metrics.claimable}
							error={error}
							network={data.network}
							onClose={() => setWithdrawModal(false)}
							onSubmit={doWithdraw}
						/>
					)}
					{newConnector && newConnector.model === "" && (
						<ConnectorSetupModal
							asset={asset}
							busy={!!busy}
							connection={newConnector}
							copied={copied && !!launchCommand}
							error={error}
							launchCommand={launchCommand}
							onClose={closeConnector}
							onCopy={copy}
							onCopyStart={copyConnectorStart}
							onPublish={(input) =>
								void run("publish", async (isCurrent) => {
									await publishLocalDraft.mutateAsync({
										id: newConnector.id,
										...input,
									});
									if (!isCurrent()) return;
									setNewConnector(null);
									navigate("pool");
									setNotice("模型已上架，连接器将按所选模型接单。");
								})
							}
							onReset={() => resetConnector(newConnector.id)}
						/>
					)}
					{newConnector && newConnector.model !== "" && (
						<ConnectorLaunchModal
							busy={!!busy}
							connection={newConnector}
							error={error}
							launchCommand={launchCommand}
							onClose={closeConnector}
							onCopy={copy}
							onCopyStart={copyConnectorStart}
						/>
					)}
					{listingModal && !walletMismatch && (
						<ListingModal
							asset={asset}
							busy={!!busy}
							error={error}
							onClose={() => !busy && setListingModal(false)}
							onSubmit={submitListing}
						/>
					)}
					{keyModal && !walletMismatch && (
						<KeyModal
							asset={asset}
							busy={busy}
							error={error}
							keyName={keyName}
							loading={!uiPreview && catalogQuery.isLoading}
							models={catalog}
							onClose={() => setKeyModal(false)}
							onKeyNameChange={setKeyName}
							onModelsChange={setAllowedModels}
							onRetry={() => void catalogQuery.refetch()}
							onSubmit={submitKey}
							queryError={catalogQuery.error?.message ?? null}
							selectedModels={allowedModels}
						/>
					)}
				</>
			)}
		</div>
	);
}
