"use client";

import {
	ArrowRight,
	ArrowUpRight,
	Check,
	CheckCheck,
	ChevronDown,
	Code2,
	Copy,
	GitBranch,
	Github,
	Layers3,
	Menu,
	MoveUpRight,
	ShieldCheck,
	Terminal,
	Wallet,
	X,
	Zap,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import {
	type PointerEvent,
	type ReactNode,
	useEffect,
	useRef,
	useState,
} from "react";
import { SETTLEMENT_CHAINS } from "~/shared/network";
import { AssetGlyph } from "./asset-glyph";
import { BrandLogo } from "./brand-logo";
import { ChainGlyph, chainColor, chainLabel } from "./chain-glyph";
import styles from "./token2api-landing.module.css";

const repository = "https://github.com/OS-Lihua/token2api";
const snippets = {
	TypeScript: `import OpenAI from "openai";
import { randomUUID } from "node:crypto";

const client = new OpenAI({
  apiKey: process.env.TOKEN2API_KEY,
  baseURL: process.env.TOKEN2API_BASE_URL,
  maxRetries: 0,
});

const response = await client.chat.completions.create(
  {
    model: process.env.TOKEN2API_MODEL!,
    messages: [{ role: "user", content: "Hello, Token2API." }],
    max_tokens: 512,
  },
  { headers: { "Idempotency-Key": randomUUID() } },
);`,
	Python: `import os
from uuid import uuid4
from openai import OpenAI

client = OpenAI(
    api_key=os.environ["TOKEN2API_KEY"],
    base_url=os.environ["TOKEN2API_BASE_URL"],
    max_retries=0,
)

response = client.chat.completions.create(
    model=os.environ["TOKEN2API_MODEL"],
    messages=[{"role": "user", "content": "Hello, Token2API."}],
    max_tokens=512,
    extra_headers={"Idempotency-Key": str(uuid4())},
)`,
};

// A dependency-free interpretation of React Bits' SpotlightCard interaction.
function SpotlightCard({
	children,
	className = "",
}: {
	children: ReactNode;
	className?: string;
}) {
	function moveSpotlight(event: PointerEvent<HTMLDivElement>) {
		if (event.pointerType === "touch") return;
		const bounds = event.currentTarget.getBoundingClientRect();
		event.currentTarget.style.setProperty(
			"--spot-x",
			`${event.clientX - bounds.left}px`,
		);
		event.currentTarget.style.setProperty(
			"--spot-y",
			`${event.clientY - bounds.top}px`,
		);
	}
	return (
		<div
			className={`${styles.spotlight} ${className}`}
			onPointerMove={moveSpotlight}
		>
			{children}
		</div>
	);
}

function Brand() {
	return (
		<Link aria-label="Token2API 首页" className={styles.brand} href="/">
			<BrandLogo className={styles.brandLogo} />
		</Link>
	);
}

function NetworkDiagram() {
	return (
		<div aria-hidden="true" className={styles.networkDiagram}>
			<div className={styles.diagramHeading}>
				<span>多链结算网络</span>
				<span>Token2API</span>
			</div>
			<svg
				aria-hidden="true"
				className={styles.networkRoutes}
				fill="none"
				viewBox="0 0 600 540"
			>
				{SETTLEMENT_CHAINS.map((chain, index) => {
					const left = index < 4;
					const y = 95 + (index % 4) * 110;
					const target = 225 + (index % 4) * 30;
					return (
						<path
							d={
								left
									? `M182 ${y} C220 ${y} 193 ${target} 214 ${target}`
									: `M418 ${y} C380 ${y} 407 ${target} 386 ${target}`
							}
							key={chain.id}
							stroke={chainColor(chain.id)}
							strokeOpacity=".75"
							strokeWidth="1.5"
						/>
					);
				})}
			</svg>
			{SETTLEMENT_CHAINS.map((chain, index) => (
				<div
					className={styles.chainNode}
					key={chain.id}
					style={{
						left: index < 4 ? "3.3%" : "69.7%",
						top: `${(95 + (index % 4) * 110) / 5.7}%`,
					}}
				>
					<ChainGlyph className={styles.chainGlyph} id={chain.id} />
					<span className={styles.chainNodeCopy}>
						<strong>{chainLabel(chain.id, chain.name)}</strong>
						<span>{chain.nativeCurrency.symbol}</span>
					</span>
				</div>
			))}
			<div className={styles.settlementHub}>
				<Image alt="" height={44} src="/icon.svg" width={44} />
				<strong>Token2API</strong>
				<span>统一余额 · 按量结算</span>
			</div>
			<div className={styles.settlementAssets}>
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
		</div>
	);
}

const faqs = [
	{
		question: "Token2API 是什么？",
		answer:
			"Token2API 是面向 AI 资源交易的多链结算平台。调用者创建 Key、授权模型并充值，通过统一 API 调用；平台选择上游，按统一模型报价计费。提供者接入自己的网关或 pool connector，按已确认用量收款。",
	},
	{
		question: "可以使用现有的 OpenAI SDK 吗？",
		answer:
			"可以。Token2API 提供兼容 OpenAI 的文本 Chat Completions 接口，支持普通响应和流式响应。将 baseURL 改为部署地址的 /v1，并使用已授权对应模型的平台 API Key。每次新调用需要唯一的 Idempotency-Key；重试同一次调用时复用原键。",
	},
	{
		question: "如何控制调用费用？",
		answer:
			"所有 Key 共用当前钱包的预付余额，每个 Key 明确授权可用模型。平台在每次调用前预留最大费用，并固定本次上游与报价；核销不会超过预留。用量不确定时进入待核对状态，并保留资金。",
	},
	{
		question: "支持哪些链和结算资产？",
		answer:
			"支持 Ethereum 主网、Base、Arbitrum、Optimism、BSC、Polygon、Avalanche 和 Robinhood Chain，以及各链原生代币和已开通的 USDT、USDC。进入控制台后，先核对当前市场的网络和结算资产；稳定币的具体版本以代币合约为准。",
	},
	{
		question: "可以在同一笔预算中换币或跨链吗？",
		answer:
			"每个市场固定一个结算网络和一种资产。预算、报价、结算收入和退款均使用该资产，不会自动换币或跨链。钱包手续费使用所在链的原生代币，另行支付。",
	},
	{
		question: "提供者如何收款，未用预算如何退回？",
		answer:
			"提供者按资源报价结算，扣除服务费后进入可提现余额。调用者按平台统一模型报价付费；未使用的调用预留在结算、核对后退回预付账户，可继续调用或用原钱包提取。原有预算会话仍按原退款规则处理。",
	},
];
const languages: (keyof typeof snippets)[] = ["TypeScript", "Python"];

export function Token2ApiLanding() {
	const [menuOpen, setMenuOpen] = useState(false);
	const [language, setLanguage] = useState<keyof typeof snippets>("TypeScript");
	const [copyStatus, setCopyStatus] = useState("");
	const headerRef = useRef<HTMLElement>(null);
	const menuRef = useRef<HTMLButtonElement>(null);
	const copyRequest = useRef(0);
	const [activeSection, setActiveSection] = useState<string | null>(null);
	useEffect(() => {
		let frame = 0;
		function update() {
			const limit =
				(headerRef.current?.getBoundingClientRect().height ?? 76) + 40;
			let current: string | null = null;
			for (const id of ["networks", "network", "how-it-works", "developers"]) {
				const section = document.getElementById(id);
				if (section && section.getBoundingClientRect().top <= limit)
					current = `#${id}`;
			}
			setActiveSection(current);
		}
		function schedule() {
			window.cancelAnimationFrame(frame);
			frame = window.requestAnimationFrame(update);
		}
		schedule();
		window.addEventListener("scroll", schedule, { passive: true });
		window.addEventListener("resize", schedule);
		return () => {
			window.cancelAnimationFrame(frame);
			window.removeEventListener("scroll", schedule);
			window.removeEventListener("resize", schedule);
		};
	}, []);
	useEffect(() => {
		if (!menuOpen) return;
		function onKeyDown(event: KeyboardEvent) {
			if (event.key === "Escape") {
				setMenuOpen(false);
				menuRef.current?.focus();
			}
		}
		function onPointerDown(event: globalThis.PointerEvent) {
			if (
				event.target instanceof Node &&
				!headerRef.current?.contains(event.target)
			)
				setMenuOpen(false);
		}
		const desktop = window.matchMedia("(min-width: 761px)");
		const onResize = () => {
			if (desktop.matches) setMenuOpen(false);
		};
		window.addEventListener("keydown", onKeyDown);
		document.addEventListener("pointerdown", onPointerDown);
		desktop.addEventListener("change", onResize);
		return () => {
			window.removeEventListener("keydown", onKeyDown);
			document.removeEventListener("pointerdown", onPointerDown);
			desktop.removeEventListener("change", onResize);
		};
	}, [menuOpen]);
	useEffect(() => {
		if (!copyStatus) return;
		const timer = window.setTimeout(() => setCopyStatus(""), 3000);
		return () => window.clearTimeout(timer);
	}, [copyStatus]);
	const navigation = [
		{ label: "结算网络", href: "#networks" },
		{ label: "平台能力", href: "#network" },
		{ label: "如何使用", href: "#how-it-works" },
		{ label: "开发者", href: "#developers" },
	];
	async function copyCode() {
		const request = ++copyRequest.current;
		setCopyStatus("");
		try {
			await navigator.clipboard.writeText(snippets[language]);
			if (request === copyRequest.current) setCopyStatus("代码已复制");
		} catch {
			if (request === copyRequest.current)
				setCopyStatus("复制失败，请选择代码手动复制");
		}
	}
	return (
		<div className={styles.landing}>
			<a className={styles.skipLink} href="#main">
				跳到主要内容
			</a>
			<header className={styles.header} ref={headerRef}>
				<div className={styles.navContainer}>
					<Brand />
					<nav aria-label="首页导航" className={styles.desktopNav}>
						{navigation.map((item) => (
							<a
								aria-current={
									activeSection === item.href ? "location" : undefined
								}
								href={item.href}
								key={item.href}
							>
								{item.label}
							</a>
						))}
					</nav>
					<div className={styles.navActions}>
						<a
							aria-label="GitHub 源代码"
							className={styles.githubLink}
							href={repository}
							rel="noreferrer"
							target="_blank"
						>
							<Github size={19} />
						</a>
						<Link className={styles.navCta} href="/console">
							进入控制台 <ArrowUpRight size={16} />
						</Link>
						<button
							aria-controls="landing-mobile-nav"
							aria-expanded={menuOpen}
							aria-label={menuOpen ? "关闭导航" : "打开导航"}
							className={styles.menuButton}
							onClick={() => setMenuOpen(!menuOpen)}
							ref={menuRef}
							type="button"
						>
							{menuOpen ? <X size={23} /> : <Menu size={23} />}
						</button>
					</div>
				</div>
				{menuOpen && (
					<nav
						aria-label="移动端首页导航"
						className={styles.mobileNav}
						id="landing-mobile-nav"
					>
						{navigation.map((item) => (
							<a
								href={item.href}
								key={item.href}
								onClick={() => setMenuOpen(false)}
							>
								{item.label}
								<ArrowUpRight size={16} />
							</a>
						))}
					</nav>
				)}
			</header>
			<main id="main">
				<section aria-labelledby="hero-title" className={styles.hero}>
					<div className={`${styles.container} ${styles.heroGrid}`}>
						<div className={styles.heroCopy}>
							<a className={styles.settlementBadge} href="#networks">
								结算资产 <strong>原生代币 · USDT · USDC</strong>
								<ArrowUpRight aria-hidden="true" size={13} />
							</a>
							<h1 id="hero-title">
								AI 资源，
								<br />
								<span>按模型调用。</span>
							</h1>
							<p className={styles.heroDescription}>
								创建 Key、授权模型，用统一 API 接入应用。
								<br />
								按实际用量结算，费用、收入与退款都有账可查。
							</p>
							<div className={styles.heroActions}>
								<Link className={styles.primaryButton} href="/console/market">
									查看模型报价 <ArrowUpRight size={19} />
								</Link>
								<Link className={styles.textButton} href="/console/pool">
									接入我的资源 <ArrowRight size={17} />
								</Link>
							</div>
							<div className={styles.heroBenefits}>
								<span>
									<ShieldCheck size={14} />
									预算可控
								</span>
								<span>
									<GitBranch size={14} />
									多链支持
								</span>
								<span>
									<Code2 size={14} />
									统一 API
								</span>
							</div>
						</div>
						<NetworkDiagram />
					</div>
				</section>
				<div className={styles.compatibility}>
					<div className={`${styles.container} ${styles.compatibilityRow}`}>
						<span>
							<Code2 /> OpenAI SDK
						</span>
						<span>
							<Terminal /> REST API
						</span>
						<span>
							<Zap /> Streaming
						</span>
						<span>
							<Wallet /> EVM Wallets
						</span>
					</div>
				</div>
				<section
					aria-label="按任务进入工作区"
					className={`${styles.container} ${styles.taskEntries}`}
				>
					{[
						{
							title: "调用者",
							text: "查看统一报价，创建 Key 并授权可用模型。",
							href: "/console/market",
							action: "创建应用密钥",
							icon: Code2,
						},
						{
							title: "商家",
							text: "接入网关或 pool connector，管理资源与收入。",
							href: "/console/pool",
							action: "管理我的资源",
							icon: Layers3,
						},
						{
							title: "管理员",
							text: "管理模型报价与路由，审核接入地址和资源。",
							href: "/admin",
							action: "进入接入管理",
							icon: ShieldCheck,
						},
					].map(({ title, text, href, action, icon: Icon }) => (
						<Link className={styles.taskEntry} href={href} key={title}>
							<Icon aria-hidden="true" size={22} />
							<h2>{title}</h2>
							<p>{text}</p>
							<span>
								{action}
								<ArrowUpRight size={16} />
							</span>
						</Link>
					))}
				</section>
				<section
					aria-labelledby="settlement-networks-title"
					className={`${styles.container} ${styles.supportedNetworks}`}
					id="networks"
				>
					<div className={styles.sectionHeading}>
						<div>
							<span className={styles.sectionEyebrow}>结算网络</span>
							<h2 id="settlement-networks-title">支持多链，多元结算。</h2>
						</div>
						<p className={styles.sectionDescription}>
							支持以下 EVM
							主网及各链原生代币、USDT、USDC。具体开通的网络、资产与代币合约，以当前市场为准。
						</p>
					</div>
					<ul className={styles.networkGrid}>
						{SETTLEMENT_CHAINS.map((chain) => (
							<li className={styles.networkCard} key={chain.id}>
								<ChainGlyph className={styles.chainGlyph} id={chain.id} />
								<span className={styles.networkName}>
									{chain.id === 1
										? "Ethereum 主网"
										: chain.id === 56
											? "BSC · BNB Chain"
											: chain.id === 10
												? "Optimism"
												: chain.name}
								</span>
								<span className={styles.networkAsset}>
									<strong style={{ color: chainColor(chain.id) }}>
										{chain.nativeCurrency.symbol}
									</strong>
									<span>原生代币</span>
								</span>
							</li>
						))}
					</ul>
					<div className={styles.assetSummary}>
						<div>
							<strong className={styles.assetSummaryTitle}>
								<AssetGlyph size={18} symbol="USDT" />
								<AssetGlyph size={18} symbol="USDC" />
								USDT · USDC
							</strong>
							<span>稳定币结算按所在链及具体代币合约开通。</span>
						</div>
						<p>预算、报价与退款使用同一种资产；网络手续费使用本链原生代币。</p>
					</div>
				</section>
				<section
					aria-labelledby="network-title"
					className={`${styles.section} ${styles.container}`}
					id="network"
				>
					<div className={styles.sectionHeading}>
						<div>
							<h2 id="network-title">
								从调用到收款，
								<br />
								每一步都有依据。
							</h2>
						</div>
						<p className={styles.sectionDescription}>
							统一资源接入、预算托管与用量账单，
							<br />
							让买方控制支出，让提供者核对收入。
						</p>
					</div>
					<div className={styles.featureGrid}>
						<SpotlightCard className={styles.resourceCard}>
							<div aria-hidden="true" className={styles.resourceDiagram}>
								<div className={styles.resourceNode}>
									<Layers3 size={23} />
									<span>Gateway</span>
								</div>
								<div className={styles.diagramLine}>
									<span />
								</div>
								<div className={styles.diagramHub}>
									<Image alt="" height={40} src="/icon.svg" width={40} />
								</div>
								<div className={styles.diagramLine}>
									<span />
								</div>
								<div className={styles.resourceNode}>
									<Code2 size={23} />
									<span>Your app</span>
								</div>
							</div>
							<h3>多种资源，一个入口。</h3>
							<p>
								通过 gateway 或 pool connector 接入资源。
								<br />
								统一调用接口，减少重复集成。
							</p>
						</SpotlightCard>
						<SpotlightCard className={styles.budgetCard}>
							<ShieldCheck
								className={styles.featureIcon}
								size={31}
								strokeWidth={1.4}
							/>
							<h3>
								统一余额与报价，
								<br />
								再开始调用。
							</h3>
							<p>
								按模型授权，平台选择可用上游。
								<br />
								调用前预留，按确认用量计费。
							</p>
							<div aria-hidden="true" className={styles.budgetVisual}>
								<div />
							</div>
						</SpotlightCard>
						<SpotlightCard className={styles.settlementCard}>
							<GitBranch
								className={styles.featureIcon}
								size={31}
								strokeWidth={1.4}
							/>
							<h3>
								按量结算，
								<br />
								原钱包提取。
							</h3>
							<p>
								核对用量、费用与链上结算记录。
								<br />
								商家提取收入，调用者取回可用余额。
							</p>
						</SpotlightCard>
					</div>
				</section>
				<section
					aria-labelledby="how-title"
					className={styles.processSection}
					id="how-it-works"
				>
					<div className={styles.container}>
						<div className={styles.sectionHeading}>
							<div>
								<h2 id="how-title">先确认资产，再开始调用。</h2>
							</div>
							<Link className={styles.textButton} href="/console">
								打开控制台 <ArrowUpRight size={18} />
							</Link>
						</div>
						<ol className={styles.steps}>
							{[
								{
									icon: Layers3,
									title: "创建 Key 并授权",
									text: "核对网络与结算资产，创建 Key，勾选允许调用的模型。",
								},
								{
									icon: Wallet,
									title: "充值预付账户",
									text: "连接钱包，确认报价并充值预付账户。稳定币需先授权，手续费另计。",
								},
								{
									icon: Code2,
									title: "接入应用",
									text: "保存 Base URL 和 Key，用授权模型 ID 调用。平台自动选择上游。",
								},
								{
									icon: CheckCheck,
									title: "结算与提取",
									text: "核对调用费用，未用预留自动退回预付账户，商家按资源报价收款。",
								},
							].map((step, index) => (
								<li key={step.title}>
									<div className={styles.stepTop}>
										<span>0{index + 1}</span>
										<step.icon size={24} strokeWidth={1.5} />
									</div>
									<h3>{step.title}</h3>
									<p>{step.text}</p>
								</li>
							))}
						</ol>
					</div>
				</section>
				<section
					aria-labelledby="developer-title"
					className={`${styles.section} ${styles.container} ${styles.developerGrid}`}
					id="developers"
				>
					<div className={styles.developerCopy}>
						<h2 id="developer-title">
							一次接入。
							<br />
							<span>调用与结算相连。</span>
						</h2>
						<p>
							使用 OpenAI SDK 接入已授权的模型，
							<br />
							调用继续用 API，资金操作由钱包确认。
						</p>
						<ul>
							<li>
								<Check size={16} /> 兼容文本 Chat Completions
							</li>
							<li>
								<Check size={16} /> 支持流式响应与用量记录
							</li>
							<li>
								<Check size={16} /> 每个 Key 单独授权可用模型
							</li>
						</ul>
						<a
							className={styles.textButton}
							href="/api/v1/openapi.json"
							rel="noreferrer"
							target="_blank"
						>
							查看 API 规范 <ArrowUpRight size={17} />
						</a>
					</div>
					<div className={styles.codeWindow}>
						<fieldset aria-label="代码示例语言" className={styles.codeTabs}>
							{languages.map((name) => (
								<button
									aria-controls="sdk-example"
									aria-pressed={language === name}
									className={language === name ? styles.selectedTab : ""}
									id={`tab-${name}`}
									key={name}
									onClick={() => {
										copyRequest.current += 1;
										setLanguage(name);
										setCopyStatus("");
									}}
									type="button"
								>
									{name}
								</button>
							))}
							<button
								aria-label={
									copyStatus === "代码已复制" ? "代码已复制" : "复制代码"
								}
								className={styles.copyButton}
								onClick={copyCode}
								title={
									copyStatus === "代码已复制"
										? "代码已复制"
										: `复制 ${language} 示例`
								}
								type="button"
							>
								{copyStatus === "代码已复制" ? (
									<Check size={15} />
								) : (
									<Copy size={15} />
								)}
								<span>{copyStatus === "代码已复制" ? "已复制" : "复制"}</span>
							</button>
						</fieldset>
						<textarea
							aria-label={`${language} 代码示例`}
							className={styles.codeExample}
							id="sdk-example"
							readOnly
							rows={17}
							spellCheck={false}
							value={snippets[language]}
							wrap="off"
						/>
						<div className={styles.codeFooter}>
							<span>
								<span className={styles.statusDot} /> 配置部署地址、模型 Key
								与模型 ID 后使用
							</span>
							<span aria-live="polite" className={styles.copyStatus}>
								{copyStatus}
							</span>
						</div>
					</div>
				</section>
				<section
					aria-labelledby="faq-title"
					className={`${styles.container} ${styles.faqSection}`}
				>
					<div>
						<h2 id="faq-title">你可能还想知道。</h2>
					</div>
					<div className={styles.faqs}>
						{faqs.map((faq) => (
							<details key={faq.question}>
								<summary>
									{faq.question}
									<ChevronDown size={19} />
								</summary>
								<p>{faq.answer}</p>
							</details>
						))}
					</div>
				</section>
				<section aria-labelledby="cta-title" className={styles.ctaSection}>
					<div className={`${styles.container} ${styles.ctaInner}`}>
						<div>
							<h2 id="cta-title">一个 Key，调用需要的模型。</h2>
							<p>创建 Key、勾选模型并充值，上游路由由平台完成。</p>
						</div>
						<Link className={styles.primaryButton} href="/console">
							进入控制台 <MoveUpRight size={21} />
						</Link>
						<span aria-hidden="true" className={styles.ctaDecoration}>
							✳
						</span>
					</div>
				</section>
			</main>
			<footer className={styles.footer}>
				<div className={styles.container}>
					<div className={styles.footerTop}>
						<Brand />

						<a href={repository} rel="noreferrer" target="_blank">
							在 GitHub 上构建 <Github size={17} />
						</a>
					</div>
					<div className={styles.footerBottom}>
						<span>© {new Date().getFullYear()} Token2API</span>

						<a href="#main">回到顶部 ↑</a>
					</div>
				</div>
			</footer>
		</div>
	);
}
