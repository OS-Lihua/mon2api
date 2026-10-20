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
import { type FormEvent, useEffect, useRef, useState } from "react";
import { AssetGlyph } from "~/app/_components/asset-glyph";
import {
	ChainGlyph,
	chainColor,
	chainLabel,
} from "~/app/_components/chain-glyph";
import {
	type ChainContext,
	lockBudget,
	selfCloseSession,
	withdrawBalance,
} from "~/app/_components/console/chain-actions";
import type { ConnectorDraft } from "~/app/_components/console/connector-modals";
import {
	activeSession,
	onlineListings,
	type Section,
	sameAddress,
} from "~/app/_components/console/format";
import type { ChatMessage } from "~/app/_components/console/lab-section";
import { OverviewSection } from "~/app/_components/console/overview-section";
import { Badge } from "~/app/_components/console/ui";
import { useToken2ApiWallet } from "~/app/_components/wallet-provider";
import { connectorStartCommand } from "~/shared/connector-distribution";
import { parseMicroAmount, formatAmount as usd } from "~/shared/money";
import { networkMetadata, SETTLEMENT_CHAINS } from "~/shared/network";
import { isNativeAsset } from "~/shared/settlement-asset";
import type {
	BuyerConnection,
	ListingView,
	RefundView,
	SessionView,
} from "~/shared/token2api";
import { previewSnapshot, uiPreview } from "~/shared/ui-preview";
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
const MarketSection = dynamic(loadMarket);
const PoolSection = dynamic(loadPool);
const LabSection = dynamic(loadLab);
const BillingSection = dynamic(loadBilling);
const KeysSection = dynamic(loadKeys);
const RentModal = dynamic(() =>
	loadSessionModals().then((module) => module.RentModal),
);
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
	{ id: "market", label: "资源市场", icon: Globe2 },
	{ id: "pool", label: "我的资源", icon: Layers3 },
	{ id: "lab", label: "调用实验室", icon: FlaskConical },
	{ id: "billing", label: "账单与结算", icon: Blocks },
	{ id: "keys", label: "API 密钥", icon: KeyRound },
] satisfies { id: Section; label: string; icon: LucideIcon }[];
const titles: Record<Section, string> = {
	overview: "概览",
	market: "资源市场",
	pool: "我的资源",
	lab: "调用实验室",
	billing: "账单与结算",
	keys: "API 密钥",
};
const sectionDescriptions: Record<Section, string> = {
	overview: "查看资源、调用活动与当前市场的结算情况。",
	market: "比较模型与报价，选择适合你的调用资源。",
	pool: "接入并管理资源，查看连接状态与挂牌价格。",
	lab: "选择预算会话，发送请求并核对调用用量。",
	billing: "核对预算、用量与链上结算，管理未用余额。",
	keys: "为应用管理独立密钥，每个密钥绑定一个预算会话。",
};

export function Token2ApiConsole() {
	const {
		getWallet,
		address: connectedAddress,
		isConnected,
	} = useToken2ApiWallet();
	const [section, setSection] = useState<Section>("overview");
	const [billingTarget, setBillingTarget] = useState(false);
	const [mobileOpen, setMobileOpen] = useState(false);
	const menuButtonRef = useRef<HTMLButtonElement>(null);
	const sidebarRef = useRef<HTMLElement>(null);
	const headingRef = useRef<HTMLHeadingElement>(null);
	const [busy, setBusy] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [notice, setNotice] = useState<string | null>(null);
	const [listingModal, setListingModal] = useState(false);
	const [rentListing, setRentListing] = useState<ListingView | null>(null);
	const [budget, setBudget] = useState("5");
	const [keyModal, setKeyModal] = useState(false);
	const [refundSession, setRefundSession] = useState<SessionView | null>(null);
	const [refundInfo, setRefundInfo] = useState<RefundView | null>(null);
	const [withdrawModal, setWithdrawModal] = useState(false);
	const [keyName, setKeyName] = useState("My application");
	const [selectedSession, setSelectedSession] = useState("");
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
	const openSession = api.token2api.openSession.useMutation();
	const confirmSession = api.token2api.confirmSession.useMutation();
	const createKey = api.token2api.createKey.useMutation();
	const revokeKey = api.token2api.revokeKey.useMutation();
	const chat = api.token2api.chat.useMutation();
	const settle = api.token2api.settle.useMutation();
	const requestRefund = api.token2api.requestRefund.useMutation();
	const withdraw = api.token2api.withdraw.useMutation();
	const data = uiPreview ? previewSnapshot : snapshot.data;
	const asset = data?.network.asset ?? "ETH";
	const nativeSymbol = data ? networkMetadata(data.network).nativeSymbol : "";
	const viewer = data?.viewer;
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
		setSelectedSession("");
		setConversationId("");
		setRentListing(null);
		setKeyModal(false);
		setListingModal(false);
		setError(null);
		setNotice(null);
		setBusy(null);
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

	const sessions =
		data?.sessions.filter(
			(session) =>
				activeSession(session) &&
				sameAddress(session.consumer, viewer?.address),
		) ?? [];
	const sessionId = sessions.some((item) => item.id === selectedSession)
		? selectedSession
		: (sessions[0]?.id ?? "");
	const selected = sessions.find((item) => item.id === sessionId);
	const closeMobileMenu = () => {
		setMobileOpen(false);
		menuButtonRef.current?.focus();
	};
	useEffect(() => {
		if (!mobileOpen) return;
		const onEscape = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				setMobileOpen(false);
				menuButtonRef.current?.focus();
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
					?.querySelector<HTMLButtonElement>(".nav-item.active")
					?.focus();
			}
		}, 220);
		return () => {
			window.clearTimeout(focusTimeout);
			window.removeEventListener("keydown", onEscape);
		};
	}, [mobileOpen]);
	const navigate = (value: Section) => {
		setSection(value);
		setBillingTarget(false);
		setMobileOpen(false);
		window.requestAnimationFrame(() => headingRef.current?.focus());
	};
	const run = async (
		name: string,
		action: (isCurrent: () => boolean) => Promise<void>,
	) => {
		if (busy) return;
		if (walletMismatch && name !== "login" && name !== "logout") {
			setError("钱包与登录身份不一致，请在钱包菜单中重新连接并签名登录。");
			return;
		}
		const generation = identityGeneration.current;
		const isCurrent = () => identityGeneration.current === generation;
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
			if (isCurrent()) setBusy(null);
		}
	};
	const chainContext = (isCurrent: () => boolean): ChainContext | null =>
		data && viewer
			? { getWallet, network: data.network, address: viewer.address, isCurrent }
			: null;
	const rent = (event: FormEvent) => {
		event.preventDefault();
		void run("rent", async (isCurrent) => {
			const context = chainContext(isCurrent);
			if (!rentListing || !context || !viewer) return;
			const amount = parseMicroAmount(budget);
			if (amount < 1_000_000 || amount > 100_000_000)
				throw new Error(`预算应在 1 至 100 ${asset} 之间。`);
			if (!viewer.demo) await getWallet(context.network, viewer.address);
			if (!isCurrent()) return;
			const result = await openSession.mutateAsync({
				listingId: rentListing.id,
				budget: amount,
			});
			if (!isCurrent()) return;
			if (result.mode === "wallet") {
				const hash = await lockBudget(context, result.transaction);
				const confirmed = await confirmSession.mutateAsync({
					id: result.id,
					txHash: hash,
				});
				if (isCurrent() && confirmed.connection)
					setNewKey(confirmed.connection);
			}
			if (!isCurrent()) return;
			if (result.connection) setNewKey(result.connection);
			setSelectedSession(result.id);
			setRentListing(null);
			navigate("keys");
			setNotice(`${asset} 预算已开通。请保存下方 Base URL、API Key 和模型名。`);
		});
	};
	const resetConversation = () => {
		setMessages([]);
		setConversationId("");
	};
	const submitChat = (event: FormEvent) => {
		event.preventDefault();
		if (!prompt.trim() || !sessionId) return;
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
			const result = await chat.mutateAsync({
				sessionId,
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
					meta: `${result.inputTokens} 输入 · ${result.outputTokens} 输出 · ${usd(result.cost, true)} · ${result.usageSource}`,
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
			const result = await createKey.mutateAsync({ sessionId, name: keyName });
			if (!isCurrent()) return;
			setNewKey(result);
			setKeyModal(false);
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
			setNotice(await selfCloseSession(context, session.id));
		});
	const copy = async (value: string) => {
		try {
			await navigator.clipboard.writeText(value);
			setCopied(true);
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
	const openRent = (listing: ListingView) => {
		if (uiPreview) {
			setRentListing(listing);
			return;
		}
		if (!data?.network.ready) {
			setNotice("当前市场的结算服务暂不可用，请稍后重试。");
			return;
		}
		if (!viewer) {
			setNotice("先连接钱包并签名登录，再创建预算会话。");
			window.scrollTo({ top: 0, behavior: "smooth" });
			return;
		}
		setRentListing(listing);
	};
	const headingAction =
		section === "overview" ? (
			<button
				className="button"
				disabled={snapshot.isFetching}
				onClick={() => void snapshot.refetch()}
				type="button"
			>
				<RefreshCw className={snapshot.isFetching ? "spin" : ""} size={12} />
				刷新数据
			</button>
		) : section === "pool" ? (
			<button
				className="button primary"
				disabled={!viewer || !data?.network.escrow || !!busy}
				onClick={() => setListingModal(true)}
				type="button"
			>
				<Plus size={13} />
				接入资源
			</button>
		) : section === "keys" ? (
			<button
				className="button primary"
				disabled={!sessions.length || !!busy}
				onClick={() => setKeyModal(true)}
				type="button"
			>
				<Plus size={13} />
				创建密钥
			</button>
		) : null;

	return (
		<div className="app-shell">
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
					<span className="brand-mark">
						<Image
							alt=""
							height={36}
							loading="eager"
							src="/token2api-mark.svg"
							unoptimized
							width={36}
						/>
					</span>
					<div>
						<div className="brand-name">
							Token2API<span className="brand-dot">.</span>
						</div>
					</div>
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
						<button
							aria-current={section === id ? "page" : undefined}
							className={`nav-item ${section === id ? "active" : ""}`}
							key={id}
							onClick={() => navigate(id)}
							type="button"
						>
							<Icon size={17} strokeWidth={1.6} />
							<span>{label}</span>
							{id === "market" && data && (
								<span className="nav-count">
									{onlineListings(data.listings)}
								</span>
							)}
						</button>
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
			<div className="main-shell">
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
						<strong>{titles[section]}</strong>
					</div>
					<div className="topbar-actions">
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
				<main className="content">
					<div
						className={`page-heading ${section === "overview" ? "overview-heading" : ""}`}
					>
						<div>
							<span className="workspace-caption">多链结算工作台</span>
							<h1 ref={headingRef} tabIndex={-1}>
								{titles[section]}
							</h1>
							<p className="workspace-description">
								{sectionDescriptions[section]}
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
							{section === "overview" && (
								<OverviewSection
									busy={!!busy}
									data={data}
									nativeSymbol={nativeSymbol}
									navigate={navigate}
									onRent={openRent}
									sessions={sessions}
								/>
							)}
							{section === "market" && (
								<MarketSection busy={!!busy} data={data} onRent={openRent} />
							)}
							{section === "pool" && (
								<PoolSection
									busy={!!busy}
									data={data}
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
										})
									}
								/>
							)}
							{section === "lab" && (
								<LabSection
									asset={asset}
									busy={busy}
									messages={messages}
									navigate={navigate}
									onNewConversation={resetConversation}
									onOpenBilling={() => {
										navigate("billing");
										setBillingTarget(true);
									}}
									onPromptChange={setPrompt}
									onSelectSession={(value) => {
										setSelectedSession(value);
										resetConversation();
									}}
									onSubmit={submitChat}
									prompt={prompt}
									sessionId={sessionId}
									sessions={sessions}
								/>
							)}
							{section === "billing" && (
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
											setNotice(
												"链上预算已确认，可以开始调用或创建 API 密钥。",
											);
										})
									}
									onFocused={() => setBillingTarget(false)}
									onRefund={(session) => {
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
							)}
							{section === "keys" && (
								<KeysSection
									busy={!!busy}
									copied={copied}
									data={data}
									hasSessions={sessions.length > 0}
									model={selected?.model}
									navigate={navigate}
									newKey={newKey}
									onCopy={(value) => void copy(value)}
									onCreateKey={() => setKeyModal(true)}
									onRevoke={(id) =>
										void run("revoke", async () => {
											await revokeKey.mutateAsync({ id });
											setNewKey(null);
											setNotice("密钥已撤销，不能再用于新请求。");
										})
									}
								/>
							)}
						</>
					)}
				</main>
			</div>
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
										? "退款已可提取，请在钱包确认提现。"
										: "退款申请已保存，处理期间停止新调用。",
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
			{rentListing && data && !walletMismatch && (
				<RentModal
					budget={budget}
					busy={busy}
					error={error}
					listing={rentListing}
					nativeSymbol={nativeSymbol}
					network={data.network}
					onBudgetChange={setBudget}
					onClose={() => setRentListing(null)}
					onSubmit={rent}
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
							setSection("pool");
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
					onClose={() => setKeyModal(false)}
					onKeyNameChange={setKeyName}
					onSelectSession={setSelectedSession}
					onSubmit={submitKey}
					sessionId={sessionId}
					sessions={sessions}
				/>
			)}
		</div>
	);
}
