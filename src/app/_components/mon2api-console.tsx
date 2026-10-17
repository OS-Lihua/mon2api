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
import { ConsoleSelect } from "~/app/_components/console-select";
import { useMon2ApiWallet } from "~/app/_components/wallet-provider";
import { escrowAbi, tokenAbi } from "~/lib/abi";
import type {
	ListingView,
	NetworkInfo,
	SessionView,
	Snapshot,
} from "~/shared/mon2api";
import { formatDUSD, parseMicroDUSD } from "~/shared/money";
import { previewSnapshot, uiPreview } from "~/shared/ui-preview";
import { api } from "~/trpc/react";

type Section = "overview" | "market" | "pool" | "lab" | "billing" | "keys";
const navigation = [
	{ id: "overview", label: "概览", icon: LayoutDashboard },
	{ id: "market", label: "资源市场", icon: Globe2 },
	{ id: "pool", label: "我的号池", icon: Layers3 },
	{ id: "lab", label: "调用实验室", icon: FlaskConical },
	{ id: "billing", label: "账单结算", icon: Blocks },
	{ id: "keys", label: "API 密钥", icon: KeyRound },
] satisfies { id: Section; label: string; icon: typeof Activity }[];
const titles: Record<Section, string> = {
	overview: "概览",
	market: "资源市场",
	pool: "我的号池",
	lab: "调用实验室",
	billing: "账单与结算",
	keys: "API 密钥",
};
const usd = formatDUSD;
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
	const [keyName, setKeyName] = useState("My application");
	const [selectedSession, setSelectedSession] = useState("");
	const [newKey, setNewKey] = useState<string | null>(null);
	const [prompt, setPrompt] = useState("用三句话解释 mon2api 的链上结算流程。");
	const [messages, setMessages] = useState<ChatMessage[]>([]);
	const [conversationId, setConversationId] = useState(() => "");
	const [copied, setCopied] = useState(false);
	const [showAllSessions, setShowAllSessions] = useState(false);
	const [showAllRequests, setShowAllRequests] = useState(false);
	const [showAllSettlements, setShowAllSettlements] = useState(false);
	const [showAllKeys, setShowAllKeys] = useState(false);
	const snapshot = api.mon2api.snapshot.useQuery(
		{ gatewayOnly: true },
		{
			refetchInterval: 15_000,
			retry: 1,
		},
	);
	const createListing = api.mon2api.createListing.useMutation();
	const toggleListing = api.mon2api.toggleListing.useMutation();
	const openSession = api.mon2api.openSession.useMutation();
	const confirmSession = api.mon2api.confirmSession.useMutation();
	const createKey = api.mon2api.createKey.useMutation();
	const revokeKey = api.mon2api.revokeKey.useMutation();
	const chat = api.mon2api.chat.useMutation();
	const settle = api.mon2api.settle.useMutation();
	const closeSession = api.mon2api.closeSession.useMutation();
	const withdraw = api.mon2api.withdraw.useMutation();
	const data = uiPreview ? previewSnapshot : snapshot.data;
	const visibleListings = (data?.listings ?? []).filter((item) =>
		`${item.name} ${item.model} ${item.owner}`
			.toLowerCase()
			.includes(search.trim().toLowerCase()),
	);
	const viewer = data?.viewer;
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
			const amount = parseMicroDUSD(budget);
			if (amount < 1_000_000 || amount > 100_000_000)
				throw new Error("预算应在 1 至 100 dUSD 之间。");
			if (!viewer.demo) await getWallet(data.network, viewer.address);
			if (!isCurrent()) return;
			const result = await openSession.mutateAsync({
				listingId: rentListing.id,
				budget: amount,
			});
			if (!isCurrent()) return;
			if (result.mode === "wallet") {
				const { wallet, account, publicClient } = await getWallet(
					data.network,
					viewer.address,
				);
				if (!isCurrent()) return;
				if (account.toLowerCase() !== viewer.address.toLowerCase())
					throw new Error("当前钱包与登录地址不同，请重新连接钱包。");
				const approval = await wallet.writeContract({
					account,
					address: getAddress(data.network.token),
					abi: tokenAbi,
					functionName: "approve",
					args: [
						getAddress(data.network.escrow),
						BigInt(result.transaction.budget),
					],
				});
				const approvalReceipt = await publicClient.waitForTransactionReceipt({
					hash: approval,
				});
				if (approvalReceipt.status !== "success")
					throw new Error("代币授权交易失败，预算尚未锁定。");
				if (!isCurrent()) return;
				const verifiedWallet = await getWallet(data.network, viewer.address);
				if (!isCurrent()) return;
				const { id, termsHash } = result.transaction;
				if (!isHex(id) || !isHex(termsHash))
					throw new Error("会话交易参数无效。");
				const hash = await verifiedWallet.wallet.writeContract({
					account: verifiedWallet.account,
					address: getAddress(data.network.escrow),
					abi: escrowAbi,
					functionName: "openSession",
					args: [
						id,
						getAddress(result.transaction.provider),
						termsHash,
						BigInt(result.transaction.budget),
						BigInt(result.transaction.expiresAt),
					],
				});
				const receipt =
					await verifiedWallet.publicClient.waitForTransactionReceipt({ hash });
				if (receipt.status !== "success") throw new Error("预算锁定交易失败。");
				if (!isCurrent()) return;
				await confirmSession.mutateAsync({ id: result.id, txHash: hash });
			}
			if (!isCurrent()) return;
			setSelectedSession(result.id);
			setRentListing(null);
			navigate("lab");
			setNotice(
				"预算会话已创建。现在可以发起调用，或为外部应用创建 API 密钥。",
			);
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
			setNewKey(result.key);
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
			await createListing.mutateAsync({
				name: String(form.get("name")),
				description: String(form.get("description")),
				model: String(form.get("model")),
				kind: "gateway",
				connectionMode,
				inputRate: parseMicroDUSD(String(form.get("inputRate"))),
				outputRate: parseMicroDUSD(String(form.get("outputRate"))),
				concurrency: Number(form.get("concurrency")),
				baseUrl: String(form.get("baseUrl")),
				apiKey: String(form.get("apiKey")),
			});
			if (!isCurrent()) return;
			setListingModal(false);
			setNotice("资源已接入。凭证仅保存在服务端，不会展示给调用方。");
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
	const requireLogin = () => {
		setNotice("先连接钱包并签名登录，再创建预算会话。");
		window.scrollTo({ top: 0, behavior: "smooth" });
	};
	const openRent = (listing: ListingView) => {
		if (!data?.network.ready) {
			setNotice("链上服务尚未就绪，请先启动本地链并部署合约。");
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
				<a aria-label="mon2api 首页" className="brand" href="/">
					<span className="brand-mark">
						<Image
							alt=""
							height={36}
							loading="eager"
							src="/mon2api-mark.svg"
							unoptimized
							width={36}
						/>
					</span>
					<div>
						<div className="brand-name">
							mon2api<span className="brand-dot">.</span>
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
									{data.listings.filter((item) => item.enabled).length}
								</span>
							)}
						</button>
					))}
				</nav>
				<div className="sidebar-bottom">
					<div className="network-panel">
						<div className="network-title">
							<span
								className={`status-dot ${data?.network.ready ? "" : "warn"}`}
							/>
							{data?.network.mode === "monad-testnet"
								? "Monad Testnet"
								: "Local EVM"}
						</div>
						<p>测试代币 · 非真实资金</p>
					</div>
					<div className="sidebar-links">
						<a
							href="https://github.com/OS-Lihua/mon2api"
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
									? `Chain ${data.network.chainId} · 合约已连接`
									: "等待合约连接"
							}
						>
							<span
								className={`status-dot ${data?.network.ready ? "" : "warn"}`}
							/>
							{data?.network.mode === "monad-testnet"
								? "Monad 测试网"
								: "本地 EVM"}
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
							<h1 ref={headingRef} tabIndex={-1}>
								{currentTitle}
							</h1>
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
								disabled={!viewer || !!busy}
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
											<h2>先锁预算，再调用 AI 资源。</h2>
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
										<Panel className="overview-side" title="网络概况">
											<div className="panel-body overview-ledger">
												<div className="overview-ledger-row">
													<span>可用资源</span>
													<strong>
														{
															data.listings.filter((item) => item.enabled)
																.length
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
											data.listings.length ? "dUSD / 百万 Token" : undefined
										}
										title="发现可用资源"
									>
										<ResourceTable
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
												: `${data.listings.length} 个资源 · ${data.listings.filter((item) => item.enabled).length} 个已上架`}
										</output>
									</div>
									<p className="market-disclosure">
										模型 ID 与价格由提供者声明 · 暂无可比官方价 · dUSD
										为无兑付价值的测试代币
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
														挂牌价 · dUSD / 百万 Token
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
														最低预算 1 dUSD
													</span>
													<button
														className="button primary small"
														disabled={
															!item.enabled || !data.network.ready || !!busy
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
											busy={!!busy}
											listings={data.listings.filter(
												(item) =>
													item.owner.toLowerCase() ===
													viewer?.address.toLowerCase(),
											)}
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
												description="使用页首的「接入资源」，添加你自行部署的上游网关。"
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
													<small>dUSD</small>
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
																: "MON2API / RESPONSE"}
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
														: usd(data.metrics.claimable, true)}
													{data.metrics.claimable !== null && (
														<small>dUSD</small>
													)}
												</div>
												<div className="balance-row">
													<span>
														钱包余额{" "}
														{data.metrics.walletBalance === null
															? "暂不可用"
															: usd(data.metrics.walletBalance)}
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
													ESCROW / {data.network.escrow || "尚未部署"}
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
											onClose={(id) =>
												void run("close", async () => {
													await closeSession.mutateAsync({ sessionId: id });
													setNotice("会话已关闭，剩余预算已转入可提现余额。");
												})
											}
											onConfirm={(id) =>
												void run("confirm", async () => {
													await confirmSession.mutateAsync({ id });
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
										<div className="key-reveal">
											<p>密钥仅显示一次，请立即保存。</p>
											<div>
												<code className="mono">{newKey}</code>
												<button
													aria-label="复制新密钥"
													className="icon-button"
													onClick={() => void copy(newKey)}
													type="button"
												>
													{copied ? <Check size={13} /> : <Copy size={13} />}
												</button>
											</div>
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
											<pre className="code-block mono">{`curl http://localhost:3000/api/v1/chat/completions \\\n  -H "Authorization: Bearer $MON2API_KEY" \\\n  -H "Content-Type: application/json" \\\n  -H "Idempotency-Key: example-request-0001" \\\n  -d '{\n    "model": "${selected?.model ?? "YOUR_MODEL_ID"}",\n    "messages": [{"role":"user","content":"Hello"}],\n    "stream": true\n  }'`}</pre>
											<p className="code-hint">
												把地址替换为你的部署域名。API
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
									<dt>输入 / 百万 Token</dt>
									<dd>{usd(rentListing.inputRate)} dUSD</dd>
								</div>
								<div>
									<dt>输出 / 百万 Token</dt>
									<dd>{usd(rentListing.outputRate)} dUSD</dd>
								</div>
							</dl>
							<p>
								{rentListing.kind === "demo"
									? "模拟资源，无官方同款可比较。"
									: "模型 ID 和价格由提供者声明，模型身份未核验。"}
							</p>
						</div>
						<div className="field">
							<label htmlFor="rent-budget">锁定预算（dUSD）</label>
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
								会话固定此资源、提供者和挂牌价快照。每次调用先预留预算，关闭会话后可提取未使用的部分。dUSD
								是无兑付价值的测试代币。请在钱包中确认代币授权和锁定交易。
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
								disabled={!!busy}
								type="submit"
							>
								{busy === "rent" ? (
									<LoaderCircle className="spin" size={12} />
								) : (
									<Wallet size={12} />
								)}
								{busy === "rent" ? "正在确认链上交易…" : "锁定预算并开始"}
							</button>
						</div>
					</form>
				</Modal>
			)}
			{listingModal && !walletMismatch && (
				<ListingModal
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
									description: `${short(item.id)} · 剩余 ${usd(Math.max(0, item.budget - item.spent - item.reserved), true)} dUSD`,
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
			unit: "dUSD",
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
			unit: "dUSD",
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
	listings,
	onRent,
	onToggle,
	busy,
}: {
	listings: ListingView[];
	onRent?: (listing: ListingView) => void;
	onToggle?: (listing: ListingView) => void;
	busy: boolean;
}) {
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
											: "已暂停"}
								</Badge>
							</td>
							<td>
								{onToggle ? (
									<button
										className="button small"
										disabled={busy}
										onClick={() => onToggle(item)}
										type="button"
									>
										<Power size={10} />
										{item.enabled ? "暂停" : "上架"}
									</button>
								) : (
									<button
										className="text-link"
										disabled={!item.enabled || busy}
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
											item.status.toLowerCase() === "closed" ||
											item.status.toLowerCase() === "draft" ||
											item.consumer.toLowerCase() !==
												data.viewer?.address.toLowerCase()
										}
										onClick={() => onClose(item.id)}
										type="button"
									>
										关闭会话
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
function ListingModal({
	error,
	onClose,
	onSubmit,
	busy,
}: {
	onClose: () => void;
	onSubmit: (event: FormEvent<HTMLFormElement>) => void;
	error: string | null;
	busy: boolean;
}) {
	const [connectionMode, setConnectionMode] = useState<"api" | "oauth_pool">(
		"api",
	);
	const isPool = connectionMode === "oauth_pool";
	return (
		<Modal
			className="resource-modal"
			error={error}
			onClose={onClose}
			title="接入 AI 资源"
		>
			<form onSubmit={onSubmit}>
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
					<div className="field">
						<label htmlFor="listing-model">模型标识</label>
						<input
							id="listing-model"
							maxLength={100}
							name="model"
							placeholder="填写上游实际支持的模型 ID"
							required
						/>
					</div>
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
				<div className="field-row resource-credentials">
					<div className="field">
						<label htmlFor="listing-url">
							{isPool ? "号池网关地址" : "API 服务地址"}
						</label>
						<input
							id="listing-url"
							key={`url-${connectionMode}`}
							name="baseUrl"
							placeholder={
								isPool
									? "https://your-pool.example/v1"
									: "https://api.example.com/v1"
							}
							required
							type="url"
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
							placeholder={
								isPool ? "填写绑定该号池的调用 Key" : "填写上游 API Key"
							}
							required
							type="password"
						/>
						<small>
							{isPool
								? "请使用仅绑定目标号池的推理 Key，不要使用网关管理密钥。"
								: "凭证加密保存，仅用于服务端调用，不向使用者公开。"}
						</small>
					</div>
				</div>
				<div className="field-row">
					<div className="field">
						<label htmlFor="listing-input">输入单价 / 百万 Token（dUSD）</label>
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
							输出单价 / 百万 Token（dUSD）
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
						defaultValue="2"
						id="listing-concurrency"
						max="20"
						min="1"
						name="concurrency"
						required
						type="number"
					/>
				</div>
				<div className="form-actions">
					<button
						className="button"
						disabled={busy}
						onClick={onClose}
						type="button"
					>
						取消
					</button>
					<button className="button primary" disabled={busy} type="submit">
						{busy ? (
							<LoaderCircle className="spin" size={12} />
						) : (
							<Plus size={12} />
						)}
						接入并上架
					</button>
				</div>
			</form>
		</Modal>
	);
}
