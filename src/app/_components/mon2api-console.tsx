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
	ChevronRight,
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
	LogOut,
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
	Terminal,
	Wallet,
	X,
	Zap,
} from "lucide-react";
import {
	type FormEvent,
	type ReactNode,
	useEffect,
	useRef,
	useState,
} from "react";
import { getAddress, isHex } from "viem";
import { useMon2ApiWallet } from "~/app/_components/wallet-provider";
import { env } from "~/env";
import { escrowAbi, tokenAbi } from "~/lib/abi";
import type {
	ListingView,
	NetworkInfo,
	SessionView,
	Snapshot,
} from "~/shared/mon2api";
import { formatDUSD, parseMicroDUSD } from "~/shared/money";
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
const titles: Record<
	Section,
	{ title: string; subtitle: string; eyebrow: string }
> = {
	overview: {
		title: "资源流转，一目了然。",
		subtitle: "选择资源，锁定预算，按实际用量结算。",
		eyebrow: "工作台 / 概览",
	},
	market: {
		title: "资源市场",
		subtitle: "发现可用模型，锁定调用预算，按实际用量付费。",
		eyebrow: "发现资源",
	},
	pool: {
		title: "我的号池",
		subtitle: "接入你有权提供的 AI 服务，管理资源状态与并发。",
		eyebrow: "提供资源",
	},
	lab: {
		title: "调用实验室",
		subtitle: "发送一次请求，查看用量与费用。",
		eyebrow: "发起调用",
	},
	billing: {
		title: "账单与结算",
		subtitle: "从一次调用到一笔交易，每一份费用都有记录。",
		eyebrow: "核对费用",
	},
	keys: {
		title: "API 密钥",
		subtitle: "为预算会话创建独立密钥，通过兼容接口接入应用。",
		eyebrow: "接入应用",
	},
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
	description: string;
	children?: ReactNode;
}) {
	return (
		<div className="empty-state">
			<Icon size={27} strokeWidth={1.3} />
			<h3>{title}</h3>
			<p>{description}</p>
			{children}
		</div>
	);
}
function Panel({
	title,
	subtitle,
	action,
	children,
	className = "",
}: {
	title: string;
	subtitle?: string;
	action?: ReactNode;
	children: ReactNode;
	className?: string;
}) {
	return (
		<section className={`panel ${className}`}>
			<div className="panel-header">
				<div>
					<h2>{title}</h2>
					{subtitle && <p>{subtitle}</p>}
				</div>
				{action}
			</div>
			{children}
		</section>
	);
}
function Modal({
	error,
	title,
	onClose,
	children,
}: {
	title: string;
	error?: string | null;
	onClose: () => void;
	children: ReactNode;
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
			className="modal"
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
	const snapshot = api.mon2api.snapshot.useQuery(undefined, {
		refetchInterval: 15_000,
		retry: 1,
	});
	const demoLogin = api.mon2api.demoLogin.useMutation();
	const logout = api.mon2api.logout.useMutation();
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
	const data = snapshot.data;
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
	const loginDemo = (role: "consumer" | "provider") =>
		run("login", async () => {
			await demoLogin.mutateAsync({ role });
			setMessages([]);
			setSelectedSession("");
			setConversationId("");
			setNewKey(null);
			setNotice(
				role === "consumer"
					? "已进入使用者演示。预算使用本地测试代币，模型响应为模拟。"
					: "已切换为资源提供者，可管理种子资源并提取已结算收益。",
			);
		});
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
			const kind = form.get("kind") === "gateway" ? "gateway" : "demo";
			await createListing.mutateAsync({
				name: String(form.get("name")),
				description: String(form.get("description")),
				model: String(form.get("model")),
				kind,
				inputRate: parseMicroDUSD(String(form.get("inputRate"))),
				outputRate: parseMicroDUSD(String(form.get("outputRate"))),
				concurrency: Number(form.get("concurrency")),
				...(kind === "gateway"
					? {
							baseUrl: String(form.get("baseUrl")),
							apiKey: String(form.get("apiKey")),
						}
					: {}),
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
		setNotice("先选择演示身份或连接钱包，再创建预算会话。");
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
						<Network size={33} strokeWidth={1.9} />
					</span>
					<div>
						<div className="brand-name">
							mon2api<span className="brand-dot">.</span>
						</div>
						<div className="brand-sub">AI 资源清算网络</div>
					</div>
				</a>
				<div className="workspace-tag">
					<div className="workspace-icon">M2</div>
					<span>开发者工作空间</span>
				</div>
				<p className="nav-label">工作区</p>
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
							<span className="network-mode">
								{data?.network.mode === "monad-testnet" ? "TESTNET" : "LOCAL"}
							</span>
						</div>
						<p>
							{data?.network.ready
								? `Chain ${data.network.chainId} · 合约已连接`
								: "等待本地合约连接"}
							<br />
							测试代币 · 非真实资金
						</p>
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
						<span>工作空间</span>
						<ChevronRight size={12} />
						<strong>
							{navigation.find((item) => item.id === section)?.label}
						</strong>
					</div>
					<div className="topbar-actions">
						<span className="topbar-status">
							<span className="status-dot warn" />
							{data?.network.mode === "monad-testnet"
								? "测试网模式"
								: "本地 EVM"}{" "}
							·{" "}
							{data?.listings.some((item) => item.kind === "gateway")
								? "含外部连接器"
								: "模拟模型"}
						</span>
						{viewer?.demo ? (
							<button
								className="wallet-button demo-exit"
								disabled={!!busy}
								onClick={() =>
									void run("logout", async () => {
										await logout.mutateAsync();
										setNewKey(null);
										setMessages([]);
									})
								}
								title="退出当前演示身份"
								type="button"
							>
								<span className="demo-pill">演示</span>
								<span className="mono">{short(viewer.address)}</span>
								<LogOut size={13} />
								<span className="demo-exit-label">退出演示</span>
							</button>
						) : (
							<div className="wallet-connect">
								<ConnectButton
									accountStatus="address"
									chainStatus="icon"
									label="连接钱包"
									showBalance={false}
								/>
							</div>
						)}
					</div>
				</header>
				<main className="content">
					<div className="page-heading">
						<div>
							<p className="eyebrow">{currentTitle.eyebrow}</p>
							<h1 ref={headingRef} tabIndex={-1}>
								{currentTitle.title}
							</h1>
							<p className="page-description">{currentTitle.subtitle}</p>
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
									<span>暂时无法连接后端，请确认数据库与开发服务已启动。</span>
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
										链上服务尚未就绪。启动本地链并部署合约后，可体验锁定预算、结算和提现。
									</span>
								</div>
							)}
							{!viewer && section !== "overview" && (
								<div className="notice info">
									<Wallet size={14} />
									<span>
										当前为访客模式。进入演示身份后，即可创建资源、调用模型与查看账单。
									</span>
									<button
										className="text-link"
										disabled={!!busy}
										onClick={() => void loginDemo("consumer")}
										type="button"
									>
										进入演示 <ArrowRight size={12} />
									</button>
								</div>
							)}
							{section === "overview" && (
								<>
									<section className="hero">
										<div className="hero-copy">
											<p className="eyebrow">mon2api 资源网络</p>
											<h2>让 AI 资源的每一次调用，都有据可循。</h2>
											<p>
												一个接口接入资源。预算独立锁定，用量在链下计量，费用在链上结算。
											</p>
											<div className="hero-actions">
												{viewer ? (
													<>
														<button
															className="button lime"
															onClick={() => navigate("market")}
															type="button"
														>
															查看可用资源 <ArrowRight size={16} />
														</button>
														{viewer.demo && (
															<button
																className="button"
																disabled={!!busy}
																onClick={() =>
																	void loginDemo(
																		viewer.name
																			.toLowerCase()
																			.includes("provider")
																			? "consumer"
																			: "provider",
																	)
																}
																type="button"
															>
																<RefreshCw size={11} />
																切换演示角色
															</button>
														)}
													</>
												) : (
													<>
														<button
															className="button lime"
															disabled={!!busy}
															onClick={() => void loginDemo("consumer")}
															type="button"
														>
															{busy === "login" ? (
																<LoaderCircle className="spin" size={12} />
															) : (
																<Zap size={12} />
															)}
															体验使用资源 <ArrowRight size={16} />
														</button>
														<button
															className="button"
															disabled={!!busy}
															onClick={() => void loginDemo("provider")}
															type="button"
														>
															体验提供资源 <ArrowUpRight size={16} />
														</button>
													</>
												)}
											</div>
											{!viewer && (
												<p className="wallet-onboarding">
													未安装钱包？
													<a
														href="https://rabby.io/"
														rel="noreferrer"
														target="_blank"
													>
														安装浏览器钱包 <ExternalLink size={10} />
													</a>
													。
													{!env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID && (
														<span>当前支持浏览器钱包，扫码连接尚未配置。</span>
													)}
												</p>
											)}
										</div>
										<div className="hero-route">
											<div className="hero-route-heading">
												<span>一次调用如何完成结算</span>
												<span aria-hidden="true" className="hero-route-symbol">
													↗
												</span>
											</div>
											<div className="hero-flow">
												{[
													{
														icon: Layers3,
														title: "资源",
														text: "选择模型与提供者",
													},
													{ icon: Wallet, title: "预算", text: "锁定支出上限" },
													{
														icon: Activity,
														title: "用量",
														text: "记录每次调用",
													},
													{
														icon: Coins,
														title: "结算",
														text: "链上分账与退款",
													},
												].map(({ icon: Icon, title, text }, index) => (
													<div className="flow-item" key={title}>
														<div
															className={`flow-node ${index === 3 ? "flow-node-final" : ""}`}
														>
															<span className="flow-node-icon">
																<Icon size={18} strokeWidth={1.6} />
															</span>
															<span className="flow-node-title">{title}</span>
															<span className="flow-node-description">
																{text}
															</span>
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
											<div className="hero-proof">
												<ShieldCheck size={15} />
												<span>固定资源与价格快照 · 预算不会超扣</span>
											</div>
										</div>
									</section>
									<Stats data={data} />
									<div className="two-columns">
										<Panel
											action={<span className="chart-timezone">本地时间</span>}
											subtitle="近六小时 · 当前已加载的请求"
											title="调用活动"
										>
											<UsageChart data={data} />
										</Panel>
										<Panel
											className="overview-side"
											subtitle="当前资源和预算会话"
											title="网络概况"
										>
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
												<p>
													用量由网关报告；链上交易记录结算，不证明请求执行。
												</p>
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
										subtitle="价格为 dUSD / 百万 Token；每个会话有独立预算"
										title="发现可用资源"
									>
										<ResourceTable
											busy={!!busy}
											listings={data.listings.slice(0, 4)}
											onRent={openRent}
										/>
										<div className="table-footer">
											<span>
												{data.listings.length} 个资源 · 价格单位：dUSD / 百万
												Token
											</span>
											<span>兼容 OpenAI Chat Completions</span>
										</div>
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
												placeholder="搜索资源名称、声明模型或提供者…"
												value={search}
											/>
										</div>
										<span className="badge neutral">
											{data.listings.filter((item) => item.enabled).length}{" "}
											个已上架
										</span>
									</div>
									<p className="market-disclosure">
										模型 ID 与价格由提供者声明 · 暂无可比官方价 · dUSD
										为无兑付价值的测试代币
									</p>
									<div className="resource-grid">
										{data.listings
											.filter((item) =>
												`${item.name} ${item.model} ${item.owner}`
													.toLowerCase()
													.includes(search.toLowerCase()),
											)
											.map((item) => (
												<article className="resource-card" key={item.id}>
													<div className="resource-card-top">
														<span className="resource-card-kind">
															{item.kind === "demo" ? "模拟资源" : "号池连接器"}
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
															提供者挂牌价 · dUSD / 百万 Token
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
															创建预算会话 <ArrowUpRight size={11} />
														</button>
													</div>
												</article>
											))}
									</div>
									{!data.listings.filter((item) =>
										`${item.name} ${item.model} ${item.owner}`
											.toLowerCase()
											.includes(search.toLowerCase()),
									).length && (
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
										<span>
											每份资源有独立凭证和并发上限。只接入有权提供的服务；限流与冷却用于保护资源，不保证避免上游停用。
										</span>
									</div>
									<Panel subtitle="接入状态与并发使用情况" title="我提供的资源">
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
												description="使用页首的「接入资源」，添加模拟资源或你自行部署的上游网关。"
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
												<select
													id="lab-session"
													onChange={(event) => {
														setSelectedSession(event.target.value);
														setMessages([]);
														setConversationId("");
													}}
													value={sessionId}
												>
													<option disabled value="">
														选择一个使用中的会话
													</option>
													{sessions.map((item) => (
														<option key={item.id} value={item.id}>
															{item.listingName} · {short(item.id)}
														</option>
													))}
												</select>
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
											<div className="notice info" style={{ margin: 0 }}>
												<Terminal size={13} />
												<span>
													网页通过 tRPC 调用。外部应用使用 OpenAI 兼容 REST
													接口。模拟资源会明确返回模拟内容。
												</span>
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
													description="响应结束后显示输入与输出 Token、计量来源和实际费用。"
													icon={Sparkles}
													title="你的下一次调用，从这里开始"
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
									<Stats data={data} />
									<div className="two-columns">
										<Panel
											subtitle="链上已结算的收益与未提取的会话退款"
											title="可提现余额"
										>
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
										subtitle="独立锁定预算；这里显示已加载的最近 100 个相关会话"
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
										subtitle="最近 200 条相关请求；待核对用量保留预算预留"
										title="调用账单"
									>
										{data.requests.length ? (
											<div className="table-scroll">
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
											</div>
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
										subtitle="最近 100 笔相关结算；无法收回的费用单独标记"
										title="链上结算记录"
									>
										{data.settlements.length ? (
											<div className="table-scroll">
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
											</div>
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
											<p>
												密钥仅在此显示一次，请立即保存。切换身份或刷新页面后将无法再次查看。
											</p>
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
										subtitle="每个密钥绑定一个预算会话，撤销后立即停止新请求"
										title="应用密钥"
									>
										{data.keys.length ? (
											<div className="table-scroll">
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
											</div>
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
											<pre className="code-block mono">{`curl http://localhost:3000/api/v1/chat/completions \\\n  -H "Authorization: Bearer $MON2API_KEY" \\\n  -H "Content-Type: application/json" \\\n  -H "Idempotency-Key: example-request-0001" \\\n  -d '{\n    "model": "${selected?.model ?? "mon2api-demo"}",\n    "messages": [{"role":"user","content":"Hello"}],\n    "stream": true\n  }'`}</pre>
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
					<footer className="footer">
						<span>
							<Network size={12} />
							mon2api · AI 资源在链下运行，价值在链上流动。
						</span>
						<span>
							<span className="status-dot warn" />
							{data?.network.mode === "monad-testnet"
								? "Monad 测试网"
								: "本地 EVM 开发环境"}{" "}
							· 测试代币 · MVP
						</span>
					</footer>
				</main>
			</div>
			{rentListing && !walletMismatch && (
				<Modal
					error={error}
					onClose={() => !busy && setRentListing(null)}
					title="创建预算会话"
				>
					<form onSubmit={rent}>
						<div className="notice info">
							<Layers3 size={14} />
							<span>
								{rentListing.name} · 提供者声明的模型 ID：{rentListing.model}
								<br />
								提供者挂牌价：输入 {usd(rentListing.inputRate)} / 输出{" "}
								{usd(rentListing.outputRate)} dUSD / 百万 Token
								<br />
								{rentListing.kind === "demo"
									? "模拟资源，无官方同款可比较。"
									: "模型身份未核验，暂无可比官方价。"}
							</span>
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
								是无兑付价值的测试代币。演示身份由服务器提交本地链交易；钱包身份需确认代币授权和锁定交易。
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
							<select
								id="key-session"
								onChange={(event) => setSelectedSession(event.target.value)}
								required
								value={sessionId}
							>
								{sessions.map((item) => (
									<option key={item.id} value={item.id}>
										{item.listingName} · 剩余{" "}
										{usd(Math.max(0, item.budget - item.spent))}
									</option>
								))}
							</select>
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
			foot: "当前已加载的相关请求",
		},
		{
			label: "Token 用量",
			value: compact(data.metrics.inputTokens + data.metrics.outputTokens),
			unit: "tokens",
			icon: Zap,
			foot: `已加载请求：${compact(data.metrics.inputTokens)} 输入 / ${compact(data.metrics.outputTokens)} 输出`,
		},
		{
			label: "计费总额",
			value: usd(
				data.metrics.spent,
				data.metrics.spent > 0 && data.metrics.spent < 10000,
			),
			unit: "dUSD",
			icon: Wallet,
			foot: `${usd(data.metrics.pending, true)} 待链上结算 · ${usd(data.metrics.writtenOff, true)} 运营损失`,
		},
		{
			label: "已结算金额",
			value: usd(
				data.metrics.settled,
				data.metrics.settled > 0 && data.metrics.settled < 10000,
			),
			unit: "dUSD",
			icon: Blocks,
			foot: "已加载会话的链上结算",
		},
	];
	return (
		<div className="stats-grid">
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
					<div className="stat-foot">{foot}</div>
				</section>
			))}
			<p className="stats-note">
				数据来自当前已加载的
				{data.requests.length >= 200 ? "最近 200 条请求" : "请求记录"}及
				{data.sessions.length >= 100 ? "最近 100 个会话" : "相关会话"}
				，并非完整历史总账。
			</p>
		</div>
	);
}
function UsageChart({ data }: { data: Snapshot }) {
	if (!data.requests.length)
		return (
			<div className="chart-empty">
				<Activity size={24} strokeWidth={1.2} />
				<span>还没有调用记录，发起第一条请求后将在这里展示。</span>
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
							<th>时段</th>
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
	if (!listings.length)
		return onToggle ? null : (
			<Empty
				description="资源提供者接入后，模型与价格会展示在这里。"
				title="暂无资源"
			/>
		);
	return (
		<div className="table-scroll">
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
									{item.kind === "demo" ? "DEMO" : "GATEWAY"}
								</span>
							</td>
							<td className="mono">
								{usd(item.inputRate)} / {usd(item.outputRate)}
							</td>
							<td className="mono">
								{item.activeRequests}
								<span style={{ color: "#9298aa" }}> / {item.concurrency}</span>
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
		</div>
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
		<div className="table-scroll">
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
								<small
									className="mono"
									style={{
										display: "block",
										marginTop: 5,
										fontSize: 8,
										color: "#7b8297",
									}}
								>
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
		</div>
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
	const [kind, setKind] = useState("demo");
	return (
		<Modal error={error} onClose={onClose} title="接入 AI 资源">
			<form onSubmit={onSubmit}>
				<div className="field">
					<label htmlFor="listing-kind">接入方式</label>
					<select
						id="listing-kind"
						name="kind"
						onChange={(event) => setKind(event.target.value)}
						value={kind}
					>
						<option value="demo">模拟模型 · 体验计量与结算</option>
						<option value="gateway">上游网关 · 自部署兼容端点</option>
					</select>
				</div>
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
							defaultValue="mon2api-demo"
							id="listing-model"
							maxLength={100}
							name="model"
							required
						/>
					</div>
				</div>
				<div className="field">
					<label htmlFor="listing-description">资源简介</label>
					<input
						id="listing-description"
						maxLength={300}
						name="description"
						placeholder="描述模型能力和适用场景"
						required
					/>
				</div>
				{kind === "gateway" && (
					<>
						<div className="field">
							<label htmlFor="listing-url">服务地址（HTTPS）</label>
							<input
								id="listing-url"
								name="baseUrl"
								placeholder="https://your-connector.example/v1"
								required
								type="url"
							/>
							<small>
								服务地址需由运营者预先加入允许列表。凭证加密保存在服务端。
							</small>
						</div>
						<div className="field">
							<label htmlFor="listing-secret">上游 API Key</label>
							<input
								autoComplete="new-password"
								id="listing-secret"
								name="apiKey"
								required
								type="password"
							/>
						</div>
					</>
				)}
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
