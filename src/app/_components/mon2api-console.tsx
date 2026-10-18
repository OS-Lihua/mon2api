"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import {
	Activity,
	ArrowDownLeft,
	ArrowRight,
	ArrowUpRight,
	Blocks,
	Check,
	CheckCheck,
	CircleHelp,
	Coins,
	Copy,
	ExternalLink,
	FlaskConical,
	Globe2,
	KeyRound,
	Layers3,
	LayoutDashboard,
	LoaderCircle,
	Menu,
	Network,
	Plus,
	Power,
	RefreshCw,
	Search,
	Send,
	Server,
	ShieldCheck,
	Sparkles,
	Wallet,
	X,
	Zap,
} from "lucide-react";
import Image from "next/image";
import {
	type FormEvent,
	type ReactNode,
	useEffect,
	useRef,
	useState,
} from "react";
import { getAddress, isHex } from "viem";
import { AssetGlyph } from "~/app/_components/asset-glyph";
import {
	ChainGlyph,
	chainColor,
	chainLabel,
} from "~/app/_components/chain-glyph";
import { ConsoleSelect } from "~/app/_components/console-select";
import { useMon2ApiWallet } from "~/app/_components/wallet-provider";
import { escrowAbi, nativeEscrowAbi, tokenAbi } from "~/lib/abi";
import { connectorStartCommand } from "~/shared/connector-distribution";
import type {
	BuyerConnection,
	ListingView,
	NetworkInfo,
	RefundView,
	SessionView,
	Snapshot,
} from "~/shared/mon2api";
import {
	formatAsset,
	formatChainBalance,
	parseMicroAmount,
} from "~/shared/money";
import { networkMetadata, SETTLEMENT_CHAINS } from "~/shared/network";
import {
	isNativeAsset,
	type SettlementAsset,
	toChainAmount,
} from "~/shared/settlement-asset";
import { previewSnapshot, uiPreview } from "~/shared/ui-preview";
import { api } from "~/trpc/react";

type Section = "overview" | "market" | "pool" | "lab" | "billing" | "keys";
const navigation = [
	{ id: "overview", label: "概览", icon: LayoutDashboard },
	{ id: "market", label: "资源市场", icon: Globe2 },
	{ id: "pool", label: "我的资源", icon: Layers3 },
	{ id: "lab", label: "调用实验室", icon: FlaskConical },
	{ id: "billing", label: "账单与结算", icon: Blocks },
	{ id: "keys", label: "API 密钥", icon: KeyRound },
] satisfies { id: Section; label: string; icon: typeof Activity }[];
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
const compact = (amount: number) =>
	Intl.NumberFormat("en-US", {
		notation: "compact",
		maximumFractionDigits: 1,
	}).format(amount);
const short = (value: string) =>
	value.length > 18 ? `${value.slice(0, 7)}…${value.slice(-5)}` : value;
const date = (value: string) =>
	new Date(value).toLocaleString("zh-CN", {
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		hour12: false,
	});
const activeSession = (session: SessionView) =>
	session.status.toLowerCase() === "active";
const statusLabel = (status: string) =>
	({
		active: "使用中",
		pending: "待确认",
		closed: "已关闭",
		closing: "关闭中",
		ready: "可用",
		online: "在线",
		paused: "已暂停",
		offline: "连接器离线",
		disabled: "已下架",
		cooldown: "冷却中",
		auth_required: "需检查连接器凭证",
		success: "成功",
		completed: "已完成",
		failed: "失败",
		settled: "已结算",
		confirmed: "已确认",
		uncollectible: "无法收回",
		running: "执行中",
		pending_usage: "待核对",
		review: "待核对",
		draft: "待确认",
	})[status.toLowerCase()] ?? status;
const statusTone = (status: string): "green" | "warn" | "neutral" => {
	const value = status.toLowerCase();
	if (
		[
			"review",
			"pending_usage",
			"failed",
			"auth_required",
			"uncollectible",
			"cooldown",
			"offline",
		].includes(value)
	)
		return "warn";
	if (
		[
			"ready",
			"online",
			"active",
			"completed",
			"confirmed",
			"success",
			"settled",
		].includes(value)
	)
		return "green";
	return "neutral";
};

function Badge({
	children,
	tone = "green",
}: {
	children: ReactNode;
	tone?: "green" | "warn" | "neutral";
}) {
	return (
		<span className={`badge ${tone === "green" ? "" : tone}`}>
			<span
				className={`status-dot ${tone === "warn" ? "warn" : tone === "neutral" ? "off" : ""}`}
			/>
			{children}
		</span>
	);
}
function Empty({
	icon: Icon = Layers3,
	title,
	description,
	children,
}: {
	icon?: typeof Activity;
	title: string;
	description?: string;
	children?: ReactNode;
}) {
	return (
		<div className="empty-state">
			<Icon size={27} strokeWidth={1.3} />
			<h3>{title}</h3>
			{description && <p>{description}</p>}
			{children}
		</div>
	);
}
function Panel({
	id,
	title,
	subtitle,
	action,
	children,
	className = "",
}: {
	id?: string;
	title: string;
	subtitle?: string;
	action?: ReactNode;
	children: ReactNode;
	className?: string;
}) {
	return (
		<section className={`panel ${className}`} id={id}>
			<div className="panel-header">
				<div>
					<h2 tabIndex={id ? -1 : undefined}>{title}</h2>
					{subtitle && <p>{subtitle}</p>}
				</div>
				{action}
			</div>
			{children}
		</section>
	);
}
function TableScroll({ children }: { children: ReactNode }) {
	return (
		<section
			aria-label="可横向滚动的表格"
			className="table-scroll"
			// biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard users need to scroll wide tables without interactive cells.
			tabIndex={0}
		>
			{children}
		</section>
	);
}
function Modal({
	error,
	title,
	onClose,
	children,
	className = "",
}: {
	title: string;
	error?: string | null;
	onClose: () => void;
	children: ReactNode;
	className?: string;
}) {
	const dialogRef = useRef<HTMLDialogElement>(null);
	useEffect(() => {
		const dialog = dialogRef.current;
		dialog?.showModal();
		return () => dialog?.close();
	}, []);
	return (
		<dialog
			aria-label={title}
			className={`modal ${className}`}
			onCancel={(event) => {
				event.preventDefault();
				onClose();
			}}
			ref={dialogRef}
		>
			<div className="modal-heading">
				<h2>{title}</h2>
				<button
					aria-label="关闭弹窗"
					className="icon-button"
					onClick={onClose}
					type="button"
				>
					<X size={15} />
				</button>
			</div>
			<div className="modal-body">
				{error && (
					<div className="notice error" role="alert">
						<CircleHelp size={14} />
						<span>{error}</span>
					</div>
				)}
				{children}
			</div>
		</dialog>
	);
}
function Transaction({
	hash,
	network,
}: {
	hash: string | null;
	network: NetworkInfo;
}) {
	if (!hash) return <span>—</span>;
	return network.explorer ? (
		<a
			className="mono text-link"
			href={`${network.explorer}/tx/${hash}`}
			rel="noreferrer"
			target="_blank"
		>
			{short(hash)} <ExternalLink size={10} />
		</a>
	) : (
		<span className="mono" title={hash}>
			{short(hash)}
		</span>
	);
}
type ChatMessage = {
	id: string;
	role: "user" | "assistant";
	content: string;
	meta?: string;
	finishReason?: "stop" | "length" | "content_filter";
};

export function Mon2ApiConsole() {
	const {
		getWallet,
		address: connectedAddress,
		isConnected,
	} = useMon2ApiWallet();
	const [section, setSection] = useState<Section>("overview");
	const [billingTarget, setBillingTarget] = useState(false);
	const [mobileOpen, setMobileOpen] = useState(false);
	const menuButtonRef = useRef<HTMLButtonElement>(null);
	const sidebarRef = useRef<HTMLElement>(null);
	const headingRef = useRef<HTMLHeadingElement>(null);
	const [busy, setBusy] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [notice, setNotice] = useState<string | null>(null);
	const [search, setSearch] = useState("");
	const [listingModal, setListingModal] = useState(false);
	const [rentListing, setRentListing] = useState<ListingView | null>(null);
	const [budget, setBudget] = useState("5");
	const [keyModal, setKeyModal] = useState(false);
	const [refundSession, setRefundSession] = useState<SessionView | null>(null);
	const [refundInfo, setRefundInfo] = useState<RefundView | null>(null);
	const [keyName, setKeyName] = useState("My application");
	const [selectedSession, setSelectedSession] = useState("");
	const [newConnector, setNewConnector] = useState<{
		id: string;
		token: string;
		model: string;
	} | null>(null);
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
	const [showAllSessions, setShowAllSessions] = useState(false);
	const [showAllRequests, setShowAllRequests] = useState(false);
	const [showAllSettlements, setShowAllSettlements] = useState(false);
	const [showAllKeys, setShowAllKeys] = useState(false);
	const snapshot = api.mon2api.snapshot.useQuery(
		{ gatewayOnly: true },
		{ refetchInterval: 15_000 },
	);
	const createLocalDraft = api.mon2api.createLocalDraft.useMutation();
	const createConnectorLaunch = api.mon2api.createConnectorLaunch.useMutation();
	const publishLocalDraft = api.mon2api.publishLocalDraft.useMutation();
	const rotateConnector = api.mon2api.rotateConnector.useMutation();
	const createListing = api.mon2api.createListing.useMutation();
	const toggleListing = api.mon2api.toggleListing.useMutation();
	const openSession = api.mon2api.openSession.useMutation();
	const confirmSession = api.mon2api.confirmSession.useMutation();
	const createKey = api.mon2api.createKey.useMutation();
	const revokeKey = api.mon2api.revokeKey.useMutation();
	const chat = api.mon2api.chat.useMutation();
	const settle = api.mon2api.settle.useMutation();
	const requestRefund = api.mon2api.requestRefund.useMutation();
	const withdraw = api.mon2api.withdraw.useMutation();
	const data = uiPreview ? previewSnapshot : snapshot.data;
	const asset = data?.network.asset ?? "ETH";
	const nativeSymbol = data ? networkMetadata(data.network).nativeSymbol : "";
	const usd = (amount: number | string, precise = false) =>
		formatAsset(amount, asset, precise);
	const visibleListings = (data?.listings ?? []).filter(
		(item) =>
			item.status !== "DISCOVERING" &&
			`${item.name} ${item.model} ${item.owner}`
				.toLowerCase()
				.includes(search.trim().toLowerCase()),
	);
	const viewer = data?.viewer;
	const refundQuery = api.mon2api.refundStatus.useQuery(
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
	const walletMismatch =
		!!viewer &&
		!viewer.demo &&
		(!isConnected ||
			connectedAddress?.toLowerCase() !== viewer.address.toLowerCase());

	const sessions =
		data?.sessions.filter(
			(session) =>
				activeSession(session) &&
				session.consumer.toLowerCase() === viewer?.address.toLowerCase(),
		) ?? [];
	const sessionId = sessions.some((item) => item.id === selectedSession)
		? selectedSession
		: (sessions[0]?.id ?? "");
	const selected = sessions.find((item) => item.id === sessionId);
	const currentTitle = titles[section];
	useEffect(() => {
		if (!billingTarget || section !== "billing" || !data) return;
		const frame = window.requestAnimationFrame(() => {
			const heading = document.querySelector<HTMLHeadingElement>(
				"#billing-requests h2",
			);
			heading?.focus();
			heading?.scrollIntoView();
			setBillingTarget(false);
		});
		return () => window.cancelAnimationFrame(frame);
	}, [billingTarget, section, data]);
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
		setSearch("");
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
	const rent = (event: FormEvent) => {
		event.preventDefault();
		void run("rent", async (isCurrent) => {
			if (!rentListing || !data || !viewer) return;
			const amount = parseMicroAmount(budget);
			if (amount < 1_000_000 || amount > 100_000_000)
				throw new Error(`预算应在 1 至 100 ${asset} 之间。`);
			if (asset === "dUSD")
				throw new Error(
					"此市场仅支持已有预算，请在已开通的结算市场创建新预算。",
				);
			if (!viewer.demo) await getWallet(data.network, viewer.address);
			if (!isCurrent()) return;
			const result = await openSession.mutateAsync({
				listingId: rentListing.id,
				budget: amount,
			});
			if (!isCurrent()) return;
			if (result.mode === "wallet") {
				const { account } = await getWallet(data.network, viewer.address);
				if (!isCurrent()) return;
				if (account.toLowerCase() !== viewer.address.toLowerCase())
					throw new Error("当前钱包与登录地址不同，请重新连接钱包。");
				const verifiedWallet = await getWallet(data.network, viewer.address);
				if (!isCurrent()) return;
				const { id, termsHash } = result.transaction;
				if (!isHex(id) || !isHex(termsHash))
					throw new Error("会话交易参数无效。");
				const chainBudget = toChainAmount(
					result.transaction.budget,
					asset,
					data.network.tokenDecimals,
				);
				if (!isNativeAsset(asset)) {
					// Reset first for tokens that require zero allowance before replacement (USDT).
					for (const allowance of [0n, chainBudget]) {
						const approvalWallet = await getWallet(
							data.network,
							viewer.address,
						);
						if (!isCurrent()) return;
						const approval = await approvalWallet.wallet.writeContract({
							account: approvalWallet.account,
							address: getAddress(data.network.token),
							abi: tokenAbi,
							functionName: "approve",
							args: [getAddress(data.network.escrow), allowance],
						});
						const receipt =
							await approvalWallet.publicClient.waitForTransactionReceipt({
								hash: approval,
							});
						if (receipt.status !== "success")
							throw new Error("代币授权交易失败。");
						if (!isCurrent()) return;
						await getWallet(data.network, viewer.address);
					}
				}
				const currentWallet = await getWallet(data.network, viewer.address);
				if (!isCurrent()) return;
				const args = [
					id,
					getAddress(result.transaction.provider),
					termsHash,
					chainBudget,
					BigInt(result.transaction.expiresAt),
				] as const;
				const hash = isNativeAsset(asset)
					? await currentWallet.wallet.writeContract({
							account: currentWallet.account,
							address: getAddress(data.network.escrow),
							abi: nativeEscrowAbi,
							functionName: "openSession",
							value: chainBudget,
							args,
						})
					: await currentWallet.wallet.writeContract({
							account: currentWallet.account,
							address: getAddress(data.network.escrow),
							abi: escrowAbi,
							functionName: "openSession",
							args,
						});
				const receipt =
					await verifiedWallet.publicClient.waitForTransactionReceipt({ hash });
				if (receipt.status !== "success") throw new Error("预算锁定交易失败。");
				if (!isCurrent()) return;
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
			const connectionMode = form.get("connectionMode");
			if (connectionMode !== "api" && connectionMode !== "oauth_pool")
				throw new Error("请选择 API 接入或 OAuth 号池。");
			const common = {
				name: String(form.get("name")),
				description: String(form.get("description")),
				connectionMode:
					connectionMode === "api" ? ("api" as const) : ("oauth_pool" as const),
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
	const doWithdraw = () =>
		run("withdraw", async (isCurrent) => {
			if (!data || !viewer) return;
			const result = await withdraw.mutateAsync();
			if (!isCurrent()) return;
			if (result.mode === "wallet") {
				const { wallet, account, publicClient } = await getWallet(
					data.network,
					viewer.address,
				);
				if (!isCurrent()) return;
				if (account.toLowerCase() !== viewer.address.toLowerCase())
					throw new Error("钱包地址与登录身份不一致。");
				const hash = await wallet.writeContract({
					account,
					address: getAddress(data.network.escrow),
					abi: escrowAbi,
					functionName: "withdraw",
				});
				const receipt = await publicClient.waitForTransactionReceipt({ hash });
				if (receipt.status !== "success") throw new Error("提现交易失败。");
			}
			if (!isCurrent()) return;
			setNotice("提现交易已确认，余额已转入收款钱包。");
		});
	const selfClose = (session: SessionView) =>
		run("self-close", async (isCurrent) => {
			if (!data || !viewer) return;
			const { account, publicClient } = await getWallet(
				data.network,
				viewer.address,
			);
			if (!isCurrent()) return;
			if (account.toLowerCase() !== viewer.address.toLowerCase())
				throw new Error("钱包地址与登录身份不一致。");
			if (!isHex(session.id)) throw new Error("会话标识无效。");
			const address = getAddress(data.network.escrow);
			const chainSession = await publicClient.readContract({
				address,
				abi: escrowAbi,
				functionName: "sessions",
				args: [session.id],
			});
			if (!isCurrent()) return;
			if (chainSession[8]) {
				setNotice(
					"链上会话已关闭。未使用预算已转入可提现余额，可点击提取余额取回。",
				);
				return;
			}
			const closeAfter = chainSession[7];
			if (closeAfter === 0n) {
				const verifiedWallet = await getWallet(data.network, viewer.address);
				if (!isCurrent()) return;
				const hash = await verifiedWallet.wallet.writeContract({
					account: verifiedWallet.account,
					address,
					abi: escrowAbi,
					functionName: "requestClose",
					args: [session.id],
				});
				const receipt = await publicClient.waitForTransactionReceipt({ hash });
				if (receipt.status !== "success") throw new Error("自助关闭申请失败。");
				if (!isCurrent()) return;
				setNotice(
					"已直接向合约申请关闭。请等待 120 秒结算窗口，再次点击钱包自助退出，关闭后可提取剩余预算。",
				);
				return;
			}
			const block = await publicClient.getBlock();
			if (!isCurrent()) return;
			if (block.timestamp < closeAfter) {
				setNotice(
					`结算窗口尚未结束。约 ${Number(closeAfter - block.timestamp)} 秒后，再次点击钱包自助退出。`,
				);
				return;
			}
			const verifiedWallet = await getWallet(data.network, viewer.address);
			if (!isCurrent()) return;
			const hash = await verifiedWallet.wallet.writeContract({
				account: verifiedWallet.account,
				address,
				abi: escrowAbi,
				functionName: "closeSession",
				args: [session.id],
			});
			const receipt = await publicClient.waitForTransactionReceipt({ hash });
			if (receipt.status !== "success") throw new Error("链上会话关闭失败。");
			if (!isCurrent()) return;
			setNotice("链上会话已关闭。剩余预算已转入可提现余额，请点击提取余额。");
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
	const requireLogin = () => {
		setNotice("先连接钱包并签名登录，再创建预算会话。");
		window.scrollTo({ top: 0, behavior: "smooth" });
	};
	const openRent = (listing: ListingView) => {
		if (uiPreview) {
			setRentListing(listing);
			return;
		}
		if (!data?.network.ready) {
			setNotice(
				uiPreview
					? "当前为界面预览，暂不支持创建预算。"
					: "当前市场的结算服务暂不可用，请稍后重试。",
			);
			return;
		}
		if (!viewer) {
			requireLogin();
			return;
		}
		setRentListing(listing);
	};

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
									{
										data.listings.filter((item) => item.enabled && item.online)
											.length
									}
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
						<strong>
							{navigation.find((item) => item.id === section)?.label}
						</strong>
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
								{currentTitle}
							</h1>
							<p className="workspace-description">
								{sectionDescriptions[section]}
							</p>
						</div>
						{section === "overview" ? (
							<button
								className="button"
								disabled={snapshot.isFetching}
								onClick={() => void snapshot.refetch()}
								type="button"
							>
								<RefreshCw
									className={snapshot.isFetching ? "spin" : ""}
									size={12}
								/>
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
						) : null}
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
								<>
									<section className="hero">
										<div className="hero-copy">
											<span className="hero-eyebrow">
												资源 · 预算 · 按量结算
											</span>
											<h2>选择资源，开始调用。</h2>
											<p className="settlement-intro">
												在同一工作台核对预算、用量与结算记录。
											</p>
											<div className="hero-actions">
												<button
													className="button lime"
													onClick={() =>
														navigate(sessions.length ? "lab" : "market")
													}
													type="button"
												>
													{sessions.length ? "继续调用" : "查看可用资源"}{" "}
													<ArrowRight size={16} />
												</button>
												{!viewer && (
													<ConnectButton
														accountStatus="address"
														chainStatus="icon"
														label="连接钱包"
														showBalance={false}
													/>
												)}
											</div>
										</div>
										<div className="hero-route">
											<div className="hero-flow">
												{[
													{
														icon: Layers3,
														title: "资源",
													},
													{ icon: Wallet, title: "预算" },
													{
														icon: Activity,
														title: "用量",
													},
													{
														icon: Coins,
														title: "结算",
													},
												].map(({ icon: Icon, title }, index) => (
													<div className="flow-item" key={title}>
														<div
															className={`flow-node ${index === 3 ? "flow-node-final" : ""}`}
														>
															<span className="flow-node-icon">
																<Icon size={18} strokeWidth={1.6} />
															</span>
															<span className="flow-node-title">{title}</span>
														</div>
														{index < 3 && (
															<span
																aria-hidden="true"
																className="flow-connector"
															/>
														)}
													</div>
												))}
											</div>
										</div>
									</section>
									<Stats data={data} />
									<div className="two-columns">
										<Panel title="调用活动">
											<UsageChart data={data} />
										</Panel>
										<Panel className="overview-side" title="当前市场">
											<div className="panel-body overview-ledger">
												<div className="overview-ledger-row">
													<span>结算网络</span>
													<strong className="settlement-value">
														{data.network.escrow ? data.network.name : "未配置"}
													</strong>
												</div>
												<div className="overview-ledger-row">
													<span>结算资产</span>
													<strong className="settlement-value">
														{data.network.escrow ? asset : "待开通"}
													</strong>
												</div>
												<div className="overview-ledger-row">
													<span>网络手续费</span>
													<strong className="settlement-value">
														{data.network.escrow ? nativeSymbol : "—"}
													</strong>
												</div>

												<div className="overview-ledger-row">
													<span>可用资源</span>
													<strong>
														{
															data.listings.filter(
																(item) => item.enabled && item.online,
															).length
														}
													</strong>
												</div>
												<div className="overview-ledger-row">
													<span>我的活跃预算会话</span>
													<strong>{sessions.length}</strong>
												</div>
												<div className="overview-ledger-row">
													<span>相关已确认结算</span>
													<strong>
														{
															data.settlements.filter(
																(item) =>
																	item.status.toLowerCase() === "confirmed",
															).length
														}
													</strong>
												</div>
											</div>
										</Panel>
									</div>
									<Panel
										action={
											<button
												className="text-link"
												onClick={() => navigate("market")}
												type="button"
											>
												查看市场 <ArrowUpRight size={11} />
											</button>
										}
										subtitle={
											data.listings.length ? `${asset} / 百万 Token` : undefined
										}
										title="发现可用资源"
									>
										<ResourceTable
											asset={asset}
											busy={!!busy}
											listings={data.listings.slice(0, 4)}
											onRent={openRent}
										/>
									</Panel>
								</>
							)}
							{section === "market" && (
								<>
									<div className="toolbar">
										<div className="search">
											<Search size={14} />
											<input
												aria-label="搜索资源"
												onChange={(event) => setSearch(event.target.value)}
												placeholder="搜索资源、模型或提供者"
												value={search}
											/>
											{search && (
												<button
													aria-label="清空资源搜索"
													className="search-clear"
													onClick={() => setSearch("")}
													type="button"
												>
													<X size={14} />
												</button>
											)}
										</div>
										<output aria-live="polite" className="search-results">
											{search.trim()
												? `找到 ${visibleListings.length} 个资源`
												: `${data.listings.length} 个资源 · ${data.listings.filter((item) => item.enabled && item.online).length} 个已上架`}
										</output>
									</div>
									<p className="market-disclosure">
										模型 ID 与价格由提供者声明 · 暂无可比官方价
										{data.network.mode === "local"
											? " · 本地资产仅供测试"
											: ` · 使用 ${asset} 结算`}
									</p>
									<div className="resource-grid">
										{visibleListings.map((item) => (
											<article className="resource-card" key={item.id}>
												<div className="resource-card-top">
													<span className="resource-card-kind">
														<span
															aria-hidden="true"
															className="resource-card-icon"
														>
															{item.kind === "demo" ? (
																<FlaskConical size={18} />
															) : (
																<Network size={18} />
															)}
														</span>
														{item.kind === "demo"
															? "模拟资源"
															: item.transport === "local"
																? "本机连接器"
																: item.connectionMode === "oauth_pool"
																	? "OAuth 号池"
																	: "API 接入"}
													</span>
													<Badge
														tone={statusTone(
															item.enabled
																? item.status
																: item.status === "AUTH_REQUIRED"
																	? "AUTH_REQUIRED"
																	: "PAUSED",
														)}
													>
														{item.enabled
															? statusLabel(item.status)
															: item.status === "AUTH_REQUIRED"
																? statusLabel(item.status)
																: item.status === "DISCOVERING"
																	? "待选择模型"
																	: "已暂停"}
													</Badge>
												</div>
												<h3>{item.name}</h3>
												<p className="resource-card-model">
													<span>声明模型</span>
													<code className="mono">{item.model}</code>
												</p>
												<p className="resource-card-description">
													{item.description}
												</p>
												<div className="resource-prices">
													<p className="resource-prices-heading">
														挂牌价 · {asset} / 百万 Token
													</p>
													<div className="resource-price">
														<span>输入</span>
														<strong>{usd(item.inputRate)}</strong>
													</div>
													<div className="resource-price">
														<span>输出</span>
														<strong>{usd(item.outputRate)}</strong>
													</div>
												</div>
												<div className="resource-card-details">
													<span>
														提供者{" "}
														<span className="mono">{short(item.owner)}</span>
													</span>
													<span>
														并发 {item.activeRequests} / {item.concurrency}
													</span>
												</div>
												<div className="resource-card-bottom">
													<span className="resource-budget-note">
														最低预算 1 {asset}
													</span>
													<button
														className="button primary small"
														disabled={
															!item.enabled ||
															!item.online ||
															(!uiPreview && !data.network.ready) ||
															!!busy
														}
														onClick={() => openRent(item)}
														type="button"
													>
														创建预算会话 <ArrowRight size={11} />
													</button>
												</div>
											</article>
										))}
									</div>
									{!visibleListings.length && (
										<Empty
											description={
												search
													? "没有匹配的名称、声明模型或提供者。清空搜索后查看全部资源。"
													: "提供者上架资源后，模型与价格会显示在这里。"
											}
											icon={Search}
											title={search ? "没有匹配的资源" : "资源市场暂时为空"}
										>
											{search && (
												<button
													className="button"
													onClick={() => setSearch("")}
													type="button"
												>
													清空搜索
												</button>
											)}
										</Empty>
									)}
								</>
							)}
							{section === "pool" && (
								<>
									<div className="notice info">
										<ShieldCheck size={14} />
										<span>仅接入有权提供的服务；限流不保证避免上游停用。</span>
									</div>
									<Panel title="我提供的资源">
										<ResourceTable
											asset={asset}
											busy={!!busy}
											listings={data.listings.filter(
												(item) =>
													item.owner.toLowerCase() ===
													viewer?.address.toLowerCase(),
											)}
											onConnect={(item) =>
												void run("connector", async (isCurrent) => {
													if (item.status === "DISCOVERING") {
														setNewConnector({
															id: item.id,
															token: "",
															model: "",
														});
														return;
													}
													const result = await rotateConnector.mutateAsync({
														id: item.id,
													});
													if (isCurrent())
														setNewConnector({ ...result, model: item.model });
												})
											}
											onToggle={(item) =>
												void run("toggle", async () => {
													await toggleListing.mutateAsync({
														id: item.id,
														enabled: !item.enabled,
													});
												})
											}
										/>
										{!data.listings.some(
											(item) =>
												item.owner.toLowerCase() ===
												viewer?.address.toLowerCase(),
										) && (
											<Empty
												description="使用页首的「接入资源」，添加本机连接器或你自行部署的上游网关。"
												title="开始提供第一份资源"
											/>
										)}
									</Panel>
								</>
							)}
							{section === "lab" && (
								<div className="chat-layout">
									<Panel className="chat-settings" title="调用配置">
										<div className="panel-body">
											<div className="field">
												<label htmlFor="lab-session">预算会话</label>
												<ConsoleSelect
													id="lab-session"
													onValueChange={(value) => {
														setSelectedSession(value);
														setMessages([]);
														setConversationId("");
													}}
													options={sessions.map((item) => ({
														value: item.id,
														label: item.listingName,
														description: `${item.model} · ${short(item.id)}`,
														icon: Wallet,
													}))}
													placeholder={
														sessions.length
															? "选择使用中的会话"
															: "暂无可用的预算会话"
													}
													value={sessionId}
												/>
											</div>
											<div className="field">
												<label htmlFor="lab-model">模型</label>
												<input
													id="lab-model"
													readOnly
													value={selected?.model ?? "尚未选择资源"}
												/>
											</div>
											<div className="field">
												<span className="field-label">可用预算</span>
												<div
													className="stat-value"
													style={{ fontSize: 24, margin: "3px 0" }}
												>
													{usd(
														selected
															? Math.max(
																	0,
																	selected.budget -
																		selected.spent -
																		selected.reserved,
																)
															: 0,
														true,
													)}
													<small>{asset}</small>
												</div>
												<small>费用先预留，再按实际用量核销。</small>
											</div>
											{!sessions.length && (
												<button
													className="button primary"
													onClick={() => navigate("market")}
													style={{ width: "100%", marginTop: 17 }}
													type="button"
												>
													先创建预算会话 <ArrowRight size={12} />
												</button>
											)}
										</div>
									</Panel>
									<Panel
										action={
											<button
												className="text-link"
												disabled={!!busy}
												onClick={() => {
													setMessages([]);
													setConversationId("");
												}}
												type="button"
											>
												<RefreshCw size={10} />
												新对话
											</button>
										}
										className="chat-window"
										subtitle={
											selected
												? `${selected.listingName} / ${selected.model}`
												: "选择会话后发送第一条消息"
										}
										title="对话终端"
									>
										<div aria-live="polite" className="chat-messages">
											{!messages.length ? (
												<Empty
													description="发送消息，查看响应与用量。"
													icon={Sparkles}
													title="开始对话"
												/>
											) : (
												messages.map((message) => (
													<div
														className={`chat-message ${message.role}`}
														key={message.id}
													>
														<div className="chat-message-label">
															{message.role === "user" ? (
																<Wallet size={11} />
															) : (
																<Network size={11} />
															)}
															{message.role === "user"
																? "YOU"
																: "TOKEN2API / RESPONSE"}
														</div>
														<p>{message.content}</p>
														{message.meta && (
															<div className="chat-message-meta mono">
																{message.meta}
															</div>
														)}
													</div>
												))
											)}
											{messages.some(
												(message) => message.role === "assistant",
											) && (
												<div className="chat-billing-link">
													<span>可在账单中核对费用与结算状态。</span>
													<button
														className="text-link"
														onClick={() => {
															navigate("billing");
															setBillingTarget(true);
														}}
														type="button"
													>
														查看调用账单 <ArrowRight size={12} />
													</button>
												</div>
											)}
											{busy === "chat" && (
												<div className="chat-message-label">
													<LoaderCircle className="spin" size={13} />
													正在等待上游响应…
												</div>
											)}
										</div>
										<form className="chat-composer" onSubmit={submitChat}>
											<label className="sr-only" htmlFor="prompt">
												消息内容
											</label>
											<textarea
												disabled={!selected || !!busy}
												id="prompt"
												maxLength={8000}
												onChange={(event) => setPrompt(event.target.value)}
												placeholder="输入你的消息…"
												value={prompt}
											/>
											<div className="chat-composer-bottom">
												<span>输出上限 512 Token · 会话内使用同一资源</span>
												<button
													className="button primary"
													disabled={!selected || !prompt.trim() || !!busy}
													type="submit"
												>
													{busy === "chat" ? (
														<LoaderCircle className="spin" size={12} />
													) : (
														<Send size={12} />
													)}
													发送请求
												</button>
											</div>
										</form>
									</Panel>
								</div>
							)}
							{section === "billing" && (
								<>
									<nav aria-label="账单内容" className="billing-jump">
										{[
											{ id: "billing-sessions", label: "预算会话" },
											{ id: "billing-requests", label: "调用账单" },
											{ id: "billing-settlements", label: "链上结算记录" },
										].map(({ id, label }) => (
											<button
												key={id}
												onClick={() => {
													const heading =
														document.querySelector<HTMLHeadingElement>(
															`#${id} h2`,
														);
													heading?.focus();
													heading?.scrollIntoView();
												}}
												type="button"
											>
												{label}
											</button>
										))}
									</nav>
									<Stats data={data} />
									<div className="two-columns">
										<Panel subtitle="收益与退款" title="可提现余额">
											<div className="panel-body billing-summary">
												<div className="stat-value">
													{data.metrics.claimable === null
														? "暂不可用"
														: formatChainBalance(
																data.metrics.claimable,
																asset,
																data.network.tokenDecimals,
															)}
													{data.metrics.claimable !== null && (
														<small>{asset}</small>
													)}
												</div>
												<div className="balance-row">
													<span>
														钱包余额{" "}
														{data.metrics.walletBalance === null
															? "暂不可用"
															: formatChainBalance(
																	data.metrics.walletBalance,
																	asset,
																	data.network.tokenDecimals,
																)}
													</span>
													<button
														className="button primary"
														disabled={
															!viewer ||
															!data.metrics.claimable ||
															data.metrics.claimable === "0" ||
															!!busy
														}
														onClick={() => void doWithdraw()}
														type="button"
													>
														<ArrowDownLeft size={12} />
														提取余额
													</button>
												</div>
											</div>
										</Panel>
										<Panel
											subtitle="费用来自网关计量，合约验证预算与分账"
											title="结算规则"
										>
											<div className="panel-body settlement-rules">
												平台服务费 {(data.network.feeBps / 100).toFixed(1)}
												%。每批账单按累计费用结算，避免重复扣款。关闭会话后，剩余预算依合约规则退回钱包。
												<p className="mono escrow-address">
													托管合约 / {data.network.escrow || "未配置"}
												</p>
											</div>
										</Panel>
									</div>
									<Panel
										action={
											data.sessions.length > 5 ? (
												<button
													aria-expanded={showAllSessions}
													className="text-link"
													onClick={() => setShowAllSessions((value) => !value)}
													type="button"
												>
													{showAllSessions
														? "收起会话"
														: `查看全部 ${data.sessions.length} 个会话`}
												</button>
											) : null
										}
										id="billing-sessions"
										subtitle="最近 100 个会话"
										title="预算会话"
									>
										<SessionTable
											busy={!!busy}
											data={data}
											onClose={(id) => {
												setRefundSession(
													data.sessions.find((item) => item.id === id) ?? null,
												);
												setRefundInfo(null);
											}}
											onConfirm={(id) =>
												void run("confirm", async () => {
													const confirmed = await confirmSession.mutateAsync({
														id,
													});
													if (confirmed.connection) {
														setNewKey(confirmed.connection);
														navigate("keys");
													}
													setNotice(
														"链上预算已确认，可以开始调用或创建 API 密钥。",
													);
												})
											}
											onSelfClose={(session) => void selfClose(session)}
											onSettle={(id) =>
												void run("settle", async () => {
													await settle.mutateAsync({ sessionId: id });
													setNotice("该会话的待结算费用已提交链上。");
												})
											}
											showAll={showAllSessions}
										/>
									</Panel>
									<div style={{ height: 22 }} />
									<Panel
										action={
											data.requests.length > 8 ? (
												<button
													aria-expanded={showAllRequests}
													className="text-link"
													onClick={() => setShowAllRequests((value) => !value)}
													type="button"
												>
													{showAllRequests
														? "收起账单"
														: `查看全部 ${data.requests.length} 条账单`}
												</button>
											) : null
										}
										id="billing-requests"
										subtitle="最近 200 条请求 · 待核对用量保留预算"
										title="调用账单"
									>
										{data.requests.length ? (
											<TableScroll>
												<table>
													<thead>
														<tr>
															<th>请求 / 时间</th>
															<th>模型</th>
															<th>输入 / 输出 Token</th>
															<th>费用</th>
															<th>计量来源</th>
															<th>状态</th>
														</tr>
													</thead>
													<tbody>
														{(showAllRequests
															? data.requests
															: data.requests.slice(0, 8)
														).map((item) => (
															<tr key={item.id}>
																<td>
																	<span className="mono">{short(item.id)}</span>
																	<small className="table-secondary">
																		{date(item.createdAt)}
																	</small>
																</td>
																<td className="mono">{item.model}</td>
																<td className="mono">
																	{item.inputTokens ?? "待核对"} /{" "}
																	{item.outputTokens ?? "待核对"}
																</td>
																<td className="mono">{usd(item.cost, true)}</td>
																<td>{item.usageSource}</td>
																<td>
																	<Badge tone={statusTone(item.status)}>
																		{item.settled
																			? "已结算"
																			: statusLabel(item.status)}
																	</Badge>
																</td>
															</tr>
														))}
													</tbody>
												</table>
											</TableScroll>
										) : (
											<Empty
												description="在调用实验室发起请求，费用会出现在这里。"
												icon={Activity}
												title="还没有调用账单"
											/>
										)}
									</Panel>
									<div style={{ height: 22 }} />
									<Panel
										action={
											data.settlements.length > 8 ? (
												<button
													aria-expanded={showAllSettlements}
													className="text-link"
													onClick={() =>
														setShowAllSettlements((value) => !value)
													}
													type="button"
												>
													{showAllSettlements
														? "收起记录"
														: `查看全部 ${data.settlements.length} 笔结算`}
												</button>
											) : null
										}
										id="billing-settlements"
										subtitle="最近 100 笔结算"
										title="链上结算记录"
									>
										{data.settlements.length ? (
											<TableScroll>
												<table>
													<thead>
														<tr>
															<th>结算批次</th>
															<th>金额</th>
															<th>时间</th>
															<th>交易</th>
															<th>状态</th>
														</tr>
													</thead>
													<tbody>
														{(showAllSettlements
															? data.settlements
															: data.settlements.slice(0, 8)
														).map((item) => (
															<tr key={item.id}>
																<td className="mono">{short(item.id)}</td>
																<td className="mono">
																	{usd(item.amount, true)}
																</td>
																<td>{date(item.createdAt)}</td>
																<td>
																	<Transaction
																		hash={item.txHash}
																		network={data.network}
																	/>
																</td>
																<td>
																	<Badge tone={statusTone(item.status)}>
																		{statusLabel(item.status)}
																	</Badge>
																</td>
															</tr>
														))}
													</tbody>
												</table>
											</TableScroll>
										) : (
											<Empty
												description="调用产生费用后，在预算会话中点击结算即可生成链上交易。"
												icon={Blocks}
												title="等待第一笔结算"
											/>
										)}
									</Panel>
								</>
							)}
							{section === "keys" && (
								<>
									{newKey && (
										<div className="key-reveal" role="status">
											<p>预算已开通。API Key 仅显示一次，请立即保存。</p>
											{(
												[
													["Base URL", newKey.base_url],
													["API Key", newKey.key],
													["模型名", newKey.model],
												] as const
											).map(([label, value]) => (
												<div key={label}>
													<strong>{label}</strong>
													<code
														className="mono"
														style={{ overflowWrap: "anywhere", minWidth: 0 }}
													>
														{value}
													</code>
													<button
														aria-label={`复制${label}`}
														className="icon-button"
														onClick={() => void copy(value)}
														type="button"
													>
														{copied ? <Check size={13} /> : <Copy size={13} />}
													</button>
												</div>
											))}
											<button
												className="button"
												onClick={() =>
													void copy(
														JSON.stringify(
															{
																base_url: newKey.base_url,
																api_key: newKey.key,
																model: newKey.model,
															},
															null,
															2,
														),
													)
												}
												type="button"
											>
												复制全部配置
											</button>
											<p>
												当前支持文本 Chat Completions。每次新调用须携带不同的
												Idempotency-Key；同一次调用重试复用原键。
											</p>
										</div>
									)}
									<Panel
										action={
											data.keys.length > 8 ? (
												<button
													aria-expanded={showAllKeys}
													className="text-link"
													onClick={() => setShowAllKeys((value) => !value)}
													type="button"
												>
													{showAllKeys
														? "收起密钥"
														: `查看全部 ${data.keys.length} 个密钥`}
												</button>
											) : null
										}
										subtitle="绑定预算会话，撤销后停止新请求"
										title="应用密钥"
									>
										{data.keys.length ? (
											<TableScroll>
												<table>
													<thead>
														<tr>
															<th>密钥名称</th>
															<th>密钥前缀</th>
															<th>预算会话</th>
															<th>创建时间</th>
															<th>状态</th>
															<th>操作</th>
														</tr>
													</thead>
													<tbody>
														{(showAllKeys
															? data.keys
															: data.keys.slice(0, 8)
														).map((item) => (
															<tr key={item.id}>
																<td>{item.name}</td>
																<td className="mono">{item.prefix}••••••••</td>
																<td className="mono">
																	{short(item.sessionId)}
																</td>
																<td>{date(item.createdAt)}</td>
																<td>
																	<Badge
																		tone={item.revoked ? "neutral" : "green"}
																	>
																		{item.revoked ? "已撤销" : "有效"}
																	</Badge>
																</td>
																<td>
																	<button
																		className="button small danger"
																		disabled={item.revoked || !!busy}
																		onClick={() =>
																			void run("revoke", async () => {
																				await revokeKey.mutateAsync({
																					id: item.id,
																				});
																				setNewKey(null);
																				setNotice(
																					"密钥已撤销，不能再用于新请求。",
																				);
																			})
																		}
																		type="button"
																	>
																		撤销密钥
																	</button>
																</td>
															</tr>
														))}
													</tbody>
												</table>
											</TableScroll>
										) : (
											<Empty
												description={
													sessions.length
														? "创建密钥后，完整内容只显示一次，请立即保存。"
														: "先在资源市场创建预算会话，再为应用创建独立密钥。"
												}
												icon={KeyRound}
												title={
													sessions.length ? "为应用创建密钥" : "先创建预算会话"
												}
											>
												<button
													className="button primary"
													onClick={() =>
														sessions.length
															? setKeyModal(true)
															: navigate("market")
													}
													type="button"
												>
													{sessions.length ? (
														<Plus size={16} />
													) : (
														<ArrowRight size={16} />
													)}
													{sessions.length ? "创建第一个密钥" : "查看资源市场"}
												</button>
											</Empty>
										)}
									</Panel>
									<div style={{ height: 22 }} />
									<Panel
										subtitle="兼容 OpenAI Chat Completions"
										title="快速接入"
									>
										<div className="panel-body">
											<pre className="code-block mono">{`curl ${newKey?.base_url ?? (typeof window === "undefined" ? "/v1" : `${window.location.origin}/v1`)}/chat/completions \\\n  -H "Authorization: Bearer $TOKEN2API_KEY" \\\n  -H "Content-Type: application/json" \\\n  -H "Idempotency-Key: example-request-0001" \\\n  -d '{\n    "model": "${selected?.model ?? "YOUR_MODEL_ID"}",\n    "messages": [{"role":"user","content":"Hello"}],\n    "stream": true\n  }'`}</pre>
											<p className="code-hint">
												Base URL 使用当前平台地址。API
												密钥绑定预算会话与资源，请保存在服务端。 每次新调用更换
												Idempotency-Key；核对同一次调用时复用原键，响应丢失后不要用新键重试。
											</p>
										</div>
									</Panel>
								</>
							)}
						</>
					)}
				</main>
			</div>
			{refundSession && !walletMismatch && (
				<Modal
					error={error}
					onClose={() => {
						if (!busy) {
							setRefundSession(null);
							setRefundInfo(null);
						}
					}}
					title={`退回未使用的 ${asset}`}
				>
					<div className="panel-body">
						<p>
							{refundSession.listingName} · {refundSession.model}
						</p>
						<p>
							可退额度：
							<strong>
								{usd(
									currentRefund?.amount ??
										Math.max(
											0,
											refundSession.budget -
												refundSession.spent -
												refundSession.reserved,
										),
									true,
								)}{" "}
								{asset}
							</strong>
						</p>
						<p>
							申请后停止新调用。退款仍使用 {asset}，提取时的网络手续费使用{" "}
							{nativeSymbol}
							。已消费费用和网络手续费不退；待核对用量继续保留预留。
						</p>
						{currentRefund && (
							<div className="notice info">
								{currentRefund.status === "AVAILABLE"
									? "退款已转入可提现余额，请用钱包提取。若此前已提取，无需重复操作。"
									: currentRefund.status === "PENDING_REVIEW"
										? "申请已保存，正在等待用量核对。预留预算不会被当作零消费释放。"
										: "申请已保存，后台正在结算并关闭会话。"}
							</div>
						)}
						{currentRefund?.txHash && data && (
							<Transaction hash={currentRefund.txHash} network={data.network} />
						)}
						<div className="form-actions">
							<button
								className="button"
								disabled={!!busy}
								onClick={() => {
									setRefundSession(null);
									setRefundInfo(null);
								}}
								type="button"
							>
								返回
							</button>
							{currentRefund?.status === "AVAILABLE" ? (
								<button
									className="button primary"
									disabled={
										!!busy ||
										!data?.metrics.claimable ||
										data.metrics.claimable === "0"
									}
									onClick={() => void doWithdraw()}
									type="button"
								>
									提取可提现 {asset} 到钱包
								</button>
							) : (
								<button
									className="button primary"
									disabled={!!busy || !!currentRefund}
									onClick={() =>
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
									type="button"
								>
									{busy === "refund" ? "正在处理…" : "确认申请退款"}
								</button>
							)}
						</div>
						{currentRefund?.status === "AVAILABLE" && (
							<p className="code-hint">
								提现会提取当前钱包的全部可提现余额，可能同时包含其他会话退款或商家收入。
							</p>
						)}
					</div>
				</Modal>
			)}
			{rentListing && !walletMismatch && (
				<Modal
					error={error}
					onClose={() => !busy && setRentListing(null)}
					title="创建预算会话"
				>
					<form onSubmit={rent}>
						<div className="rent-summary">
							<strong>{rentListing.name}</strong>
							<span className="rent-model mono">{rentListing.model}</span>
							<dl>
								<div>
									<dt>结算网络</dt>
									<dd>{data?.network.name}</dd>
								</div>
								<div>
									<dt>结算资产</dt>
									<dd>{asset}</dd>
								</div>

								<div>
									<dt>输入 / 百万 Token</dt>
									<dd>
										{usd(rentListing.inputRate)} {asset}
									</dd>
								</div>
								<div>
									<dt>输出 / 百万 Token</dt>
									<dd>
										{usd(rentListing.outputRate)} {asset}
									</dd>
								</div>
							</dl>
							{!isNativeAsset(asset) && data && (
								<p className="settlement-token">
									代币合约 <code>{data.network.token}</code>
								</p>
							)}
							<p>
								{rentListing.kind === "demo"
									? "模拟资源，无官方同款可比较。"
									: "模型 ID 和价格由提供者声明，模型身份未核验。"}
							</p>
						</div>
						<div className="field">
							<label htmlFor="rent-budget">锁定预算（{asset}）</label>
							<input
								id="rent-budget"
								max="100"
								min="1"
								onChange={(event) => setBudget(event.target.value)}
								required
								step="0.000001"
								type="number"
								value={budget}
							/>
							<small>
								会话固定此资源、提供者和 {asset}{" "}
								挂牌价快照。每次调用先预留预算，关闭后可提取未使用的 {asset}
								。网络手续费使用 {nativeSymbol}，另计。
								{isNativeAsset(asset)
									? `请在钱包中确认 ${asset} 预算锁定交易。`
									: `需先确认 ${asset} 授权，再确认预算锁定交易。`}
							</small>
						</div>
						<div className="form-actions">
							<button
								className="button"
								disabled={!!busy}
								onClick={() => setRentListing(null)}
								type="button"
							>
								取消
							</button>
							<button
								className="button primary"
								disabled={!!busy || uiPreview}
								type="submit"
							>
								{busy === "rent" ? (
									<LoaderCircle className="spin" size={12} />
								) : (
									<Wallet size={12} />
								)}
								{uiPreview
									? "预览模式 · 不执行交易"
									: busy === "rent"
										? "正在确认链上交易…"
										: "锁定预算并开始"}
							</button>
						</div>
					</form>
				</Modal>
			)}
			{newConnector && newConnector.model === "" && (
				<ConnectorSetupModal
					asset={asset}
					busy={!!busy}
					connection={newConnector}
					copied={copied && !!launchCommand}
					error={error}
					launchCommand={launchCommand}
					onClose={() => {
						setNewConnector(null);
						setLaunch(null);
					}}
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
					onReset={() =>
						void run("connector", async (isCurrent) => {
							const result = await rotateConnector.mutateAsync({
								id: newConnector.id,
							});
							if (isCurrent()) setNewConnector({ ...result, model: "" });
						})
					}
				/>
			)}
			{newConnector && newConnector.model !== "" && (
				<Modal
					error={error}
					onClose={() => {
						setNewConnector(null);
						setLaunch(null);
					}}
					title="连接本机资源"
				>
					<p>
						复制后直接在终端粘贴运行，无需另行输入平台连接凭证。启动命令 5
						分钟内有效，使用一次后失效。
					</p>
					<button
						className="button primary"
						disabled={!!busy}
						onClick={copyConnectorStart}
						type="button"
					>
						<Copy size={12} />
						复制并启动
					</button>
					<pre className="code-block mono">
						{launchCommand ??
							connectorStartCommand(window.location.origin, newConnector.model)}
					</pre>
					<p>
						本机上游 Key 按提示隐藏输入。其他网关请替换
						YOUR_UPSTREAM_URL。启动新连接会替换此资源的原连接。
					</p>
					<details>
						<summary>手动连接（高级）</summary>
						<div className="field">
							<label htmlFor="connector-token">平台连接器凭证</label>
							<input
								id="connector-token"
								readOnly
								type="password"
								value={
									launchCommand ? "请重置后使用手动连接" : newConnector.token
								}
							/>
						</div>
						<button
							className="button"
							disabled={!!launchCommand}
							onClick={() => void copy(newConnector.token)}
							type="button"
						>
							复制连接凭证
						</button>
					</details>
				</Modal>
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
				<Modal
					error={error}
					onClose={() => !busy && setKeyModal(false)}
					title="创建 API 密钥"
				>
					<form onSubmit={submitKey}>
						<div className="field">
							<label htmlFor="key-name">密钥名称</label>
							<input
								id="key-name"
								maxLength={60}
								onChange={(event) => setKeyName(event.target.value)}
								required
								value={keyName}
							/>
						</div>
						<div className="field">
							<label htmlFor="key-session">绑定预算会话</label>
							<ConsoleSelect
								id="key-session"
								onValueChange={setSelectedSession}
								options={sessions.map((item) => ({
									value: item.id,
									label: item.listingName,
									description: `${short(item.id)} · 剩余 ${usd(Math.max(0, item.budget - item.spent - item.reserved), true)} ${asset}`,
									icon: Wallet,
								}))}
								placeholder="选择要绑定的预算会话"
								required
								value={sessionId}
							/>
							<small>
								密钥只能使用该会话的预算和资源，创建后完整密钥只显示一次。
							</small>
						</div>
						<div className="form-actions">
							<button
								className="button"
								disabled={!!busy}
								onClick={() => setKeyModal(false)}
								type="button"
							>
								取消
							</button>
							<button
								className="button primary"
								disabled={!sessionId || !!busy}
								type="submit"
							>
								{busy === "key" ? (
									<LoaderCircle className="spin" size={12} />
								) : (
									<KeyRound size={12} />
								)}
								创建密钥
							</button>
						</div>
					</form>
				</Modal>
			)}
		</div>
	);
}

function Stats({ data }: { data: Snapshot }) {
	const usd = (amount: number | string, precise = false) =>
		formatAsset(amount, data.network.asset, precise);
	const items = [
		{
			label: "关联调用",
			value: compact(data.metrics.requests),
			unit: "次",
			icon: Activity,
			foot: null,
		},
		{
			label: "Token 用量",
			value: compact(data.metrics.inputTokens + data.metrics.outputTokens),
			unit: "tokens",
			icon: Zap,
			foot:
				data.metrics.inputTokens + data.metrics.outputTokens > 0
					? `${compact(data.metrics.inputTokens)} 输入 / ${compact(data.metrics.outputTokens)} 输出`
					: null,
		},
		{
			label: "计费总额",
			value: usd(
				data.metrics.spent,
				data.metrics.spent > 0 && data.metrics.spent < 10000,
			),
			unit: data.network.asset,
			icon: Wallet,
			foot:
				data.metrics.pending > 0 || data.metrics.writtenOff > 0 ? (
					<>
						{data.metrics.pending > 0 && (
							<span>待链上结算 {usd(data.metrics.pending, true)}</span>
						)}
						{data.metrics.writtenOff > 0 && (
							<span>运营损失 {usd(data.metrics.writtenOff, true)}</span>
						)}
					</>
				) : null,
		},
		{
			label: "已结算金额",
			value: usd(
				data.metrics.settled,
				data.metrics.settled > 0 && data.metrics.settled < 10000,
			),
			unit: data.network.asset,
			icon: Blocks,
			foot: null,
		},
	];
	const scope = `统计范围：当前 ${data.requests.length} 条请求、${data.sessions.length} 个会话，非完整历史。`;
	return (
		<div className="stats-grid" title={scope}>
			{items.map(({ label, value, unit, icon: Icon, foot }) => (
				<section className="stat-card" key={label}>
					<div className="stat-top">
						<span>{label}</span>
						<span className="stat-icon">
							<Icon size={13} />
						</span>
					</div>
					<div className="stat-value">
						{value}
						<small>{unit}</small>
					</div>
					{foot && <div className="stat-foot">{foot}</div>}
				</section>
			))}
			<p className="sr-only">{scope}</p>
		</div>
	);
}
function UsageChart({ data }: { data: Snapshot }) {
	if (!data.requests.length)
		return (
			<div className="chart-empty">
				<Activity size={24} strokeWidth={1.2} />
				<span>暂无调用记录</span>
			</div>
		);
	const hour = 3_600_000;
	const currentHour = Math.floor(Date.now() / hour) * hour;
	const periods = Array.from({ length: 6 }, (_, index) => {
		const start = currentHour - (5 - index) * hour;
		return {
			start,
			label: `${new Date(start).getHours().toString().padStart(2, "0")}:00`,
			count: data.requests.filter((item) => {
				const at = new Date(item.createdAt).getTime();
				return at >= start && at < start + hour;
			}).length,
		};
	});
	const max = Math.max(...periods.map((period) => period.count), 2);
	return (
		<div className="chart">
			<div className="chart-legend">
				<span>
					<i />
					请求数
				</span>
				<span>
					{periods.reduce((total, period) => total + period.count, 0)} 次 /
					六小时
				</span>
			</div>
			<div className="chart-plot">
				<div className="chart-lines">
					{[
						{ id: "max", value: max },
						{ id: "middle", value: Math.round(max / 2) },
						{ id: "zero", value: 0 },
					].map((tick) => (
						<span key={tick.id}>
							<small>{tick.value}</small>
						</span>
					))}
				</div>
				<div aria-hidden="true" className="chart-bars">
					{periods.map((period) => (
						<div className="chart-bar-slot" key={period.start}>
							<div
								className="chart-bar"
								style={{ height: `${(period.count / max) * 100}%` }}
							/>
							<span aria-hidden="true" className="chart-tooltip">
								{period.label} / {period.count} 次
							</span>
						</div>
					))}
				</div>
			</div>
			<div className="chart-labels">
				{periods.map((period) => (
					<span key={period.start}>{period.label}</span>
				))}
			</div>
			<details className="chart-data-table">
				<summary>查看逐时数据</summary>
				<table>
					<thead>
						<tr>
							<th>时段（本地时间）</th>
							<th>请求数</th>
						</tr>
					</thead>
					<tbody>
						{periods.map((period) => (
							<tr key={period.start}>
								<td>{period.label}</td>
								<td>{period.count}</td>
							</tr>
						))}
					</tbody>
				</table>
			</details>
		</div>
	);
}
function ResourceTable({
	asset,
	listings,
	onRent,
	onToggle,
	onConnect,
	busy,
}: {
	asset: SettlementAsset;
	listings: ListingView[];
	onRent?: (listing: ListingView) => void;
	onToggle?: (listing: ListingView) => void;
	onConnect?: (listing: ListingView) => void;
	busy: boolean;
}) {
	const usd = (amount: number | string, precise = false) =>
		formatAsset(amount, asset, precise);
	if (!listings.length) return onToggle ? null : <Empty title="暂无资源" />;
	return (
		<TableScroll>
			<table>
				<thead>
					<tr>
						<th>资源 / 模型</th>
						<th>接入类型</th>
						<th>输入 / 输出价格</th>
						<th>并发</th>
						<th>状态</th>
						<th>操作</th>
					</tr>
				</thead>
				<tbody>
					{listings.map((item) => (
						<tr key={item.id}>
							<td>
								<div className="resource-name">
									<span className="resource-symbol">
										<Server size={13} />
									</span>
									<div>
										{item.name}
										<small className="mono">{item.model}</small>
									</div>
								</div>
							</td>
							<td>
								<span className="badge neutral">
									{item.kind === "demo"
										? "DEMO"
										: item.transport === "local"
											? "本机连接器"
											: item.connectionMode === "oauth_pool"
												? "OAuth 号池"
												: "API"}
								</span>
							</td>
							<td className="mono">
								{usd(item.inputRate)} / {usd(item.outputRate)}
							</td>
							<td className="mono">
								{item.activeRequests}
								<span className="table-muted"> / {item.concurrency}</span>
							</td>
							<td>
								<Badge
									tone={statusTone(
										item.enabled
											? item.status
											: item.status === "AUTH_REQUIRED"
												? "AUTH_REQUIRED"
												: "PAUSED",
									)}
								>
									{item.enabled
										? statusLabel(item.status)
										: item.status === "AUTH_REQUIRED"
											? statusLabel(item.status)
											: item.status === "DISCOVERING"
												? "待选择模型"
												: "已暂停"}
								</Badge>
							</td>
							<td>
								{onToggle ? (
									<>
										<button
											className="button small"
											disabled={busy || item.status === "DISCOVERING"}
											onClick={() => onToggle(item)}
											type="button"
										>
											<Power size={10} />
											{item.enabled ? "暂停" : "上架"}
										</button>
										{item.transport === "local" && onConnect && (
											<button
												className="button small"
												disabled={busy}
												onClick={() => onConnect(item)}
												type="button"
											>
												{item.status === "DISCOVERING"
													? "继续接入"
													: "重置连接凭证"}
											</button>
										)}
									</>
								) : (
									<button
										className="text-link"
										disabled={!item.enabled || !item.online || busy}
										onClick={() => onRent?.(item)}
										type="button"
									>
										使用资源 <ArrowUpRight size={11} />
									</button>
								)}
							</td>
						</tr>
					))}
				</tbody>
			</table>
		</TableScroll>
	);
}
function SessionTable({
	onConfirm,
	onSelfClose,
	data,
	onSettle,
	onClose,
	busy,
	showAll,
}: {
	data: Snapshot;
	onConfirm: (id: string) => void;
	onSelfClose: (session: SessionView) => void;
	onSettle: (id: string) => void;
	onClose: (id: string) => void;
	busy: boolean;
	showAll: boolean;
}) {
	const usd = (amount: number | string, precise = false) =>
		formatAsset(amount, data.network.asset, precise);
	if (!data.sessions.length)
		return (
			<Empty
				description="在资源市场选择模型并锁定预算，即可开始调用。"
				icon={Wallet}
				title="还没有预算会话"
			/>
		);
	return (
		<TableScroll>
			<table>
				<thead>
					<tr>
						<th>资源 / 会话</th>
						<th>预算</th>
						<th>已消费 / 已结算 / 运营损失</th>
						<th>状态</th>
						<th>锁定交易</th>
						<th>操作</th>
					</tr>
				</thead>
				<tbody>
					{(showAll ? data.sessions : data.sessions.slice(0, 5)).map((item) => (
						<tr key={item.id}>
							<td>
								{item.listingName}
								<small className="mono table-secondary" title={item.id}>
									{short(item.id)}
								</small>
							</td>
							<td className="mono">{usd(item.budget)}</td>
							<td className="mono">
								{usd(item.spent, true)} / {usd(item.settled, true)} /{" "}
								{usd(item.writtenOff, true)}
							</td>
							<td>
								<Badge tone={statusTone(item.status)}>
									{statusLabel(item.status)}
								</Badge>
							</td>
							<td>
								<Transaction hash={item.openTx} network={data.network} />
							</td>
							<td>
								<div className="table-actions">
									{item.status === "DRAFT" &&
										item.consumer.toLowerCase() ===
											data.viewer?.address.toLowerCase() && (
											<button
												className="button small"
												disabled={busy}
												onClick={() => onConfirm(item.id)}
												type="button"
											>
												确认预算状态
											</button>
										)}
									<button
										className="button small"
										disabled={
											busy ||
											item.spent - item.settled - item.writtenOff <= 0 ||
											item.status.toLowerCase() === "closed"
										}
										onClick={() => onSettle(item.id)}
										type="button"
									>
										结算
									</button>
									<button
										className="button small"
										disabled={
											busy ||
											item.status.toLowerCase() === "draft" ||
											item.consumer.toLowerCase() !==
												data.viewer?.address.toLowerCase()
										}
										onClick={() => onClose(item.id)}
										type="button"
									>
										{item.status === "CLOSED"
											? "查看退款"
											: item.status === "CLOSING"
												? "退款处理中"
												: "申请退款"}
									</button>
									{data.viewer &&
										!data.viewer.demo &&
										item.consumer.toLowerCase() ===
											data.viewer.address.toLowerCase() &&
										item.status !== "DRAFT" &&
										item.status !== "CLOSED" && (
											<button
												className="button small"
												disabled={busy}
												onClick={() => onSelfClose(item)}
												title="直接调用合约，120 秒结算窗口后可关闭并取回预算"
												type="button"
											>
												<Wallet size={10} />
												钱包自助退出
											</button>
										)}
								</div>
							</td>
						</tr>
					))}
				</tbody>
			</table>
		</TableScroll>
	);
}
function ConnectorSetupModal({
	asset,
	connection,
	copied,
	busy,
	error,
	onClose,
	onCopy,
	onCopyStart,
	launchCommand,
	onPublish,
	onReset,
}: {
	asset: SettlementAsset;
	connection: { id: string; token: string };
	copied: boolean;
	busy: boolean;
	error: string | null;
	onClose: () => void;
	onCopy: (value: string) => Promise<void>;
	onCopyStart: () => void;
	launchCommand: string | null;
	onReset: () => void;
	onPublish: (input: {
		model: string;
		inputRate: number;
		outputRate: number;
	}) => void;
}) {
	const setup = api.mon2api.connectorSetup.useQuery(
		{ id: connection.id },
		{ refetchInterval: 2000 },
	);
	const [model, setModel] = useState("");
	const [priceError, setPriceError] = useState<string | null>(null);
	const models = setup.data?.models ?? [];
	const selected = models.includes(model) ? model : "";
	return (
		<Modal
			error={error || priceError || setup.error?.message}
			onClose={onClose}
			title="连接网关，自动读取模型"
		>
			<p>上游 Key 只在本机使用。连接器启动后，模型列表会自动出现在这里。</p>
			<p>
				在运行 Magpie 的电脑安装 Node.js 24
				或更高版本。复制后在终端粘贴运行，无需再次输入平台连接凭证。
			</p>
			<button
				className="button primary"
				disabled={busy}
				onClick={onCopyStart}
				type="button"
			>
				<Copy size={12} />
				{busy ? "正在准备…" : copied ? "已复制，请到终端粘贴" : "复制并启动"}
			</button>
			<pre className="code-block mono">
				{launchCommand ?? connectorStartCommand(window.location.origin)}
			</pre>
			<p>
				启动命令 5 分钟内有效，使用一次后失效。按提示隐藏输入 Magpie 调用
				Key；其他网关请替换上游地址。启动新连接会替换此资源的原连接。
			</p>
			<details>
				<summary>手动连接（高级）</summary>
				{connection.token && !launchCommand ? (
					<>
						<div className="field">
							<label htmlFor="connector-token">平台连接器凭证</label>
							<input
								id="connector-token"
								readOnly
								type="password"
								value={connection.token}
							/>
						</div>
						<button
							className="button"
							onClick={() => void onCopy(connection.token)}
							type="button"
						>
							复制连接凭证
						</button>
					</>
				) : (
					<p>使用已保存的凭证，或重置连接凭证后重新启动。</p>
				)}
			</details>
			<div className="notice" role="status">
				{setup.data?.online
					? `网关已连接，已读取 ${models.length} 个模型。`
					: "等待本机连接器上线并读取模型…"}
			</div>
			<form
				onSubmit={(event) => {
					event.preventDefault();
					setPriceError(null);
					const form = new FormData(event.currentTarget);
					try {
						onPublish({
							model: selected,
							inputRate: parseMicroAmount(String(form.get("inputRate"))),
							outputRate: parseMicroAmount(String(form.get("outputRate"))),
						});
					} catch (error) {
						setPriceError(
							error instanceof Error ? error.message : "请检查报价。",
						);
					}
				}}
			>
				<div className="field">
					<label htmlFor="discovered-model">选择模型</label>
					<ConsoleSelect
						disabled={!setup.data?.online || busy}
						id="discovered-model"
						onValueChange={setModel}
						options={models.map((value) => ({ value, label: value }))}
						placeholder="连接后自动读取"
						required
						value={selected}
					/>
					<small>
						模型列表来自网关声明，不表示模型身份已核验。上架后模型固定，按{" "}
						{asset} / 百万 Token 报价。
					</small>
				</div>
				<div className="field-row">
					{(["inputRate", "outputRate"] as const).map((name) => (
						<div className="field" key={name}>
							<label htmlFor={`discovered-${name}`}>
								{name === "inputRate" ? "输入" : "输出"}单价 / 百万 Token（
								{asset}）
							</label>
							<input
								defaultValue={name === "inputRate" ? "1" : "3"}
								id={`discovered-${name}`}
								max="1000"
								min="0.01"
								name={name}
								required
								step="0.000001"
								type="number"
							/>
						</div>
					))}
				</div>
				<div className="form-actions">
					<button
						className="button"
						disabled={busy}
						onClick={onReset}
						type="button"
					>
						重置连接凭证
					</button>
					<button
						className="button primary"
						disabled={busy || !setup.data?.online || !selected}
						type="submit"
					>
						确认模型并上架
					</button>
				</div>
			</form>
		</Modal>
	);
}

function ListingModal({
	asset,
	error,
	onClose,
	onSubmit,
	busy,
}: {
	asset: SettlementAsset;
	onClose: () => void;
	onSubmit: (event: FormEvent<HTMLFormElement>) => void;
	error: string | null;
	busy: boolean;
}) {
	const [connectionMode, setConnectionMode] = useState<"api" | "oauth_pool">(
		"api",
	);
	const [isLocal, setIsLocal] = useState(true);
	const isPool = connectionMode === "oauth_pool";
	const [upstreamUrl, setUpstreamUrl] = useState("");
	const [upstreamKey, setUpstreamKey] = useState("");
	const [models, setModels] = useState<string[]>([]);
	const [selectedModel, setSelectedModel] = useState("");
	const [discoveryError, setDiscoveryError] = useState<string | null>(null);
	const discovery = api.mon2api.discoverModels.useMutation();
	const generation = useRef(0);
	const resetModels = () => {
		generation.current++;
		setModels([]);
		setSelectedModel("");
		setDiscoveryError(null);
	};
	const readModels = async () => {
		const current = ++generation.current;
		setDiscoveryError(null);
		setModels([]);
		setSelectedModel("");
		try {
			const result = await discovery.mutateAsync({
				baseUrl: upstreamUrl,
				apiKey: upstreamKey,
			});
			if (current === generation.current) setModels(result.models);
		} catch (error) {
			if (current === generation.current)
				setDiscoveryError(
					error instanceof Error ? error.message : "读取模型失败。",
				);
		}
	};
	return (
		<Modal
			className="resource-modal"
			error={error || discoveryError}
			onClose={onClose}
			title="接入 AI 资源"
		>
			<form onSubmit={onSubmit}>
				<div className="field">
					<label className="connector-local-toggle">
						<input
							checked={isLocal}
							name="local"
							onChange={(event) => {
								setIsLocal(event.target.checked);
								resetModels();
							}}
							type="checkbox"
						/>{" "}
						Key 保留在本机，通过本机连接器提供服务
					</label>
					<small>
						{isLocal
							? "先连接 Magpie 或其他网关，系统自动读取模型列表。选择模型和报价后再上架，上游 Key 保留在本机。"
							: "填写网关地址和调用 Key 后读取模型列表，再选择模型和报价。平台将加密保存调用 Key。"}
					</small>
				</div>
				<fieldset className="resource-modes" disabled={busy}>
					<legend>接入方式</legend>
					<div className="resource-mode-grid">
						<label className="resource-mode">
							<input
								checked={!isPool}
								name="connectionMode"
								onChange={() => setConnectionMode("api")}
								type="radio"
								value="api"
							/>
							<span aria-hidden="true" className="resource-mode-icon">
								<KeyRound size={20} />
							</span>
							<span className="resource-mode-copy">
								<strong>API 接入</strong>
								<span>通过 API Key 提供模型服务</span>
							</span>
							<span aria-hidden="true" className="resource-mode-check">
								{!isPool && <Check size={12} strokeWidth={3} />}
							</span>
						</label>
						<label className="resource-mode">
							<input
								checked={isPool}
								name="connectionMode"
								onChange={() => setConnectionMode("oauth_pool")}
								type="radio"
								value="oauth_pool"
							/>
							<span aria-hidden="true" className="resource-mode-icon">
								<Network size={20} />
							</span>
							<span className="resource-mode-copy">
								<strong>OAuth 号池</strong>
								<span>接入已授权账号的号池网关</span>
							</span>
							<span aria-hidden="true" className="resource-mode-check">
								{isPool && <Check size={12} strokeWidth={3} />}
							</span>
						</label>
					</div>
				</fieldset>
				{isPool && (
					<div className="pool-connection-guide">
						<span className="pool-guide-heading">
							<Layers3 size={15} />
							连接你的 OAuth 号池
						</span>
						<p>
							先在 vm2api 等号池网关完成账号授权，再创建绑定该号池的专用调用
							Key。
						</p>
						<small>
							账号授权、令牌刷新和调度由号池网关管理。此处无需提交账号密码或
							OAuth 令牌。
						</small>
					</div>
				)}
				<div className="field-row">
					<div className="field">
						<label htmlFor="listing-name">资源名称</label>
						<input
							id="listing-name"
							maxLength={60}
							minLength={2}
							name="name"
							placeholder="我的 AI 资源"
							required
						/>
					</div>
					{!isLocal && (
						<div className="field">
							<label htmlFor="listing-model">选择模型</label>
							<ConsoleSelect
								disabled={models.length === 0}
								id="listing-model"
								name="model"
								onValueChange={setSelectedModel}
								options={models.map((model) => ({
									value: model,
									label: model,
								}))}
								placeholder="先读取网关模型列表"
								required
								value={selectedModel}
							/>
						</div>
					)}
				</div>
				<div className="field">
					<label htmlFor="listing-description">资源简介</label>
					<input
						id="listing-description"
						maxLength={300}
						minLength={2}
						name="description"
						placeholder="描述模型能力和适用场景"
						required
					/>
				</div>
				{!isLocal && (
					<div className="field-row resource-credentials">
						<div className="field">
							<label htmlFor="listing-url">
								{isPool ? "号池网关地址" : "API 服务地址"}
							</label>
							<input
								id="listing-url"
								key={`url-${connectionMode}`}
								name="baseUrl"
								onChange={(event) => {
									setUpstreamUrl(event.target.value);
									resetModels();
								}}
								placeholder={
									isPool
										? "https://your-pool.example/v1"
										: "https://api.example.com/v1"
								}
								required
								type="url"
								value={upstreamUrl}
							/>
							<small>
								需支持 OpenAI Chat Completions 并返回 Token
								用量。服务地址需由运营者加入允许列表。
							</small>
						</div>
						<div className="field">
							<label htmlFor="listing-secret">
								{isPool ? "号池专用调用 Key" : "API Key"}
							</label>
							<input
								autoComplete="new-password"
								id="listing-secret"
								key={`secret-${connectionMode}`}
								name="apiKey"
								onChange={(event) => {
									setUpstreamKey(event.target.value);
									resetModels();
								}}
								placeholder={
									isPool ? "填写绑定该号池的调用 Key" : "填写上游 API Key"
								}
								required
								type="password"
								value={upstreamKey}
							/>
							<small>
								{isPool
									? "请使用仅绑定目标号池的推理 Key，不要使用网关管理密钥。"
									: "凭证加密保存，仅用于服务端调用，不向使用者公开。"}
							</small>
						</div>
					</div>
				)}
				{!isLocal && (
					<>
						<div className="field">
							<button
								className="button"
								disabled={
									busy || discovery.isPending || !upstreamUrl || !upstreamKey
								}
								onClick={() => void readModels()}
								type="button"
							>
								{discovery.isPending ? "正在读取…" : "读取模型列表"}
							</button>
							<small>
								{models.length
									? `已读取 ${models.length} 个模型，请从列表中选择。`
									: "网关需提供 /v1/models。这里只读取网关声明的模型，不验证模型身份。"}
							</small>
						</div>
						<div className="field-row">
							<div className="field">
								<label htmlFor="listing-input">
									输入单价 / 百万 Token（{asset}）
								</label>
								<input
									defaultValue="1"
									id="listing-input"
									max="1000"
									min="0.01"
									name="inputRate"
									required
									step="0.000001"
									type="number"
								/>
							</div>
							<div className="field">
								<label htmlFor="listing-output">
									输出单价 / 百万 Token（{asset}）
								</label>
								<input
									defaultValue="3"
									id="listing-output"
									max="1000"
									min="0.01"
									name="outputRate"
									required
									step="0.000001"
									type="number"
								/>
							</div>
						</div>
						<div className="field">
							<label htmlFor="listing-concurrency">最大并发请求</label>
							<input
								defaultValue={isLocal ? "1" : "2"}
								id="listing-concurrency"
								key={`concurrency-${isLocal}`}
								max={isLocal ? "1" : "20"}
								min="1"
								name="concurrency"
								readOnly={isLocal}
								required
								type="number"
							/>
						</div>
					</>
				)}
				<div className="form-actions">
					<button
						className="button"
						disabled={busy}
						onClick={onClose}
						type="button"
					>
						取消
					</button>
					<button
						className="button primary"
						disabled={busy || (!isLocal && !models.includes(selectedModel))}
						type="submit"
					>
						{busy ? (
							<LoaderCircle className="spin" size={12} />
						) : (
							<Plus size={12} />
						)}
						{isLocal ? "连接网关，自动读取模型" : "接入并上架"}
					</button>
				</div>
			</form>
		</Modal>
	);
}
