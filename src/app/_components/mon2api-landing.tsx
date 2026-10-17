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
import styles from "./mon2api-landing.module.css";

const repository = "https://github.com/OS-Lihua/mon2api";
const snippets = {
	TypeScript: `import OpenAI from "openai";
import { randomUUID } from "node:crypto";

const client = new OpenAI({
  apiKey: process.env.MON2API_KEY,
  baseURL: process.env.MON2API_BASE_URL,
  maxRetries: 0,
});

const response = await client.chat.completions.create(
  {
    model: process.env.MON2API_MODEL!,
    messages: [{ role: "user", content: "Hello, mon2api." }],
    max_tokens: 512,
  },
  { headers: { "Idempotency-Key": randomUUID() } },
);`,
	Python: `import os
from uuid import uuid4
from openai import OpenAI

client = OpenAI(
    api_key=os.environ["MON2API_KEY"],
    base_url=os.environ["MON2API_BASE_URL"],
    max_retries=0,
)

response = client.chat.completions.create(
    model=os.environ["MON2API_MODEL"],
    messages=[{"role": "user", "content": "Hello, mon2api."}],
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
		<Link aria-label="mon2api 首页" className={styles.brand} href="/">
			<span className={styles.brandMark}>
				<Image alt="" height={38} src="/icon.svg" width={38} />
			</span>
			<span>
				mon2api<span className={styles.brandDot}>.</span>
			</span>
		</Link>
	);
}

function NetworkSculpture() {
	const ribbon =
		"M16.4 4.3c1.3-.8 2.9.2 2.9 1.7v4.5c0 .9-.5 1.8-1.3 2.3l-5.8 3.5c-.6.4-1 1-1 1.7v3.8c0 .7.7 1.1 1.3.8l3.8-2.3c1.3-.8 3 .2 3 1.7v4c0 1-.5 1.8-1.3 2.3l-4.8 2.9c-1.4.9-3.2.9-4.6 0l-3.2-1.9C3.9 28.4 3 26.8 3 25.1V14.8c0-1.8.9-3.4 2.4-4.3l11-6.2Z";
	return (
		<div aria-hidden="true" className={styles.sculpture}>
			<div className={styles.sculptureGlow} />
			<svg
				aria-hidden="true"
				className={styles.orbitArt}
				fill="none"
				viewBox="0 0 600 540"
			>
				<defs>
					<linearGradient id="ribbon-front" x1="0" x2="1" y1="0" y2="1">
						<stop stopColor="#eee7ff" />
						<stop offset=".35" stopColor="#b99bff" />
						<stop offset=".7" stopColor="#8955f7" />
						<stop offset="1" stopColor="#5e29db" />
					</linearGradient>
					<linearGradient id="ribbon-back" x1="0" x2="1" y1="0" y2=".5">
						<stop stopColor="#6e38dd" />
						<stop offset=".5" stopColor="#4f20bc" />
						<stop offset="1" stopColor="#a27aff" />
					</linearGradient>
					<radialGradient id="floor-shadow">
						<stop stopColor="#6e39c6" stopOpacity=".24" />
						<stop offset="1" stopColor="#6e39c6" stopOpacity="0" />
					</radialGradient>
					<path d={ribbon} id="ribbon-shape" />
				</defs>
				<ellipse cx="310" cy="441" fill="url(#floor-shadow)" rx="216" ry="61" />
				<g stroke="#b8a3df" strokeWidth=".8">
					<ellipse
						cx="303"
						cy="297"
						rx="278"
						ry="114"
						transform="rotate(-27 303 297)"
					/>
					<ellipse
						cx="303"
						cy="297"
						opacity=".42"
						rx="278"
						ry="160"
						transform="rotate(-27 303 297)"
					/>
					<ellipse
						cx="303"
						cy="297"
						opacity=".4"
						rx="239"
						ry="208"
						strokeDasharray="3 7"
						transform="rotate(-27 303 297)"
					/>
				</g>
				<g className={styles.floatingMark}>
					<g transform="translate(130 66) scale(8.5)">
						<g fill="url(#ribbon-back)" transform="translate(0 1.8)">
							<use href="#ribbon-shape" />
							<use href="#ribbon-shape" transform="rotate(180 20 20)" />
						</g>
						<g fill="url(#ribbon-front)" stroke="#d9c6ff" strokeWidth=".12">
							<use href="#ribbon-shape" />
							<use href="#ribbon-shape" transform="rotate(180 20 20)" />
						</g>
					</g>
				</g>
				<circle
					className={styles.orbitDot}
					cx="82"
					cy="370"
					fill="#8761e8"
					r="7"
				/>
				<circle cx="527" cy="219" fill="#b69aed" r="4" />
				<path d="M475 88v16m-8-8h16M100 149v12m-6-6h12" stroke="#9c7ccf" />
			</svg>
		</div>
	);
}

const faqs = [
	{
		question: "mon2api 是什么？",
		answer:
			"mon2api 是一个 AI 资源租赁市场。资源提供者通过 gateway 或 pool connector 接入上游服务；开发者选择资源、锁定预算，再通过统一 API 调用。平台记录 Token 用量，并通过链上合约完成结算与分账。",
	},
	{
		question: "可以使用现有的 OpenAI SDK 吗？",
		answer:
			"可以。mon2api 提供兼容 OpenAI 的文本 Chat Completions 接口，支持普通响应和流式响应。将 baseURL 改为部署地址的 /v1，并使用会话绑定的平台 API Key。每次新调用需要唯一的 Idempotency-Key；重试同一次调用时复用原键。",
	},
	{
		question: "如何控制调用费用？",
		answer:
			"创建预算会话时会固定资源、提供者和价格快照。请求先预留费用，再按上游报告的用量核销，收费不会超过会话预算。用量不确定时进入待核对状态，并保留对应预留金额。",
	},
	{
		question: "当前可以在哪个网络使用？",
		answer:
			"默认使用 Monad 测试网，使用无实际价值的 dUSD 测试代币。连接钱包后按提示切换网络，再完成授权和预算锁定。合约资金流程已验证；浏览器钱包与真实网关的完整流程仍待验收。",
	},
];
const languages: (keyof typeof snippets)[] = ["TypeScript", "Python"];

export function Mon2ApiLanding() {
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
			for (const id of ["network", "how-it-works", "developers"]) {
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
		{ label: "网络优势", href: "#network" },
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
							<h1 id="hero-title">
								让每一份算力
								<br />
								<span>自由流动。</span>
								<span aria-hidden="true" className={styles.headlineSpark}>
									✳
								</span>
							</h1>
							<p className={styles.heroDescription}>
								连接开放的 AI 资源网络。
								<br />
								一个 API，按量调用，让算力的价值清晰可见。
							</p>
							<div className={styles.heroActions}>
								<Link className={styles.primaryButton} href="/console">
									开始探索 <ArrowUpRight size={19} />
								</Link>
								<a className={styles.textButton} href="#developers">
									几行代码，即刻接入 <ArrowRight size={17} />
								</a>
							</div>
						</div>
						<NetworkSculpture />
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
					aria-labelledby="network-title"
					className={`${styles.section} ${styles.container}`}
					id="network"
				>
					<div className={styles.sectionHeading}>
						<div>
							<h2 id="network-title">
								好的算力，
								<br />
								值得更自由的连接。
							</h2>
						</div>
						<p className={styles.sectionDescription}>
							从资源发现到用量结算，
							<br />
							把复杂的连接留给网络，把创造留给你。
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
								先定预算，
								<br />
								再放手构建。
							</h3>
							<p>
								固定资源与价格快照。
								<br />
								按用量计费，不超过会话预算。
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
								每一次调用，
								<br />
								都有迹可循。
							</h3>
							<p>
								记录 Token 用量、费用与结算交易。
								<br />
								让消费者和提供者看清每一笔流向。
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
								<h2 id="how-title">从连接，到创造。</h2>
							</div>
							<Link className={styles.textButton} href="/console">
								打开控制台 <ArrowUpRight size={18} />
							</Link>
						</div>
						<ol className={styles.steps}>
							{[
								{
									icon: Layers3,
									title: "发现资源",
									text: "浏览资源市场，选择适合的模型与提供者。",
								},
								{
									icon: Wallet,
									title: "锁定预算",
									text: "连接钱包，确认价格，创建预算会话。",
								},
								{
									icon: Code2,
									title: "接入应用",
									text: "创建 API Key，用熟悉的 SDK 开始调用。",
								},
								{
									icon: CheckCheck,
									title: "按量结算",
									text: "查看用量账单，追踪链上结算与退款。",
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
							熟悉的代码。
							<br />
							<span>更开放的算力。</span>
						</h2>
						<p>
							保持你的开发习惯。使用 OpenAI SDK，
							<br />将 AI 资源接入现有应用。
						</p>
						<ul>
							<li>
								<Check size={16} /> 兼容文本 Chat Completions
							</li>
							<li>
								<Check size={16} /> 支持流式响应与用量记录
							</li>
							<li>
								<Check size={16} /> 每个密钥绑定独立预算会话
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
								<span className={styles.statusDot} /> 配置部署地址、会话 Key
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
							<h2 id="cta-title">让灵感，连接算力。</h2>
							<p>为你的下一个想法，找到它的运行方式。</p>
						</div>
						<Link className={styles.primaryButton} href="/console">
							开始探索 <MoveUpRight size={21} />
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
						<span>© {new Date().getFullYear()} mon2api</span>

						<a href="#main">回到顶部 ↑</a>
					</div>
				</div>
			</footer>
		</div>
	);
}
