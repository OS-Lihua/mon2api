"use client";

import {
	CircleHelp,
	ExternalLink,
	Layers3,
	LoaderCircle,
	type LucideIcon,
	X,
} from "lucide-react";
import { type ReactNode, useEffect, useId, useRef } from "react";
import type { ListingView, NetworkInfo } from "~/shared/token2api";
import { listingStatus, short, type Tone } from "./format";

export function Badge({
	children,
	tone = "green",
}: {
	children: ReactNode;
	tone?: Tone;
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
export function ListingStatusBadge({ item }: { item: ListingView }) {
	const { tone, label } = listingStatus(item);
	return <Badge tone={tone}>{label}</Badge>;
}
export function Empty({
	icon: Icon = Layers3,
	title,
	description,
	children,
}: {
	icon?: LucideIcon;
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
export function Loading({ label = "正在加载数据…" }: { label?: string }) {
	return (
		<div className="loading-state" role="status">
			<LoaderCircle className="spin" size={20} />
			<span>{label}</span>
		</div>
	);
}
export function QueryError({
	onRetry,
	message = "数据加载失败，请重试。",
}: {
	onRetry: () => void;
	message?: string;
}) {
	return (
		<Empty description={message} icon={CircleHelp} title="暂时无法读取数据">
			<button className="button" onClick={onRetry} type="button">
				重新加载
			</button>
		</Empty>
	);
}
export function Panel({
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
/** Header action that expands a list truncated to `limit` rows. */
export function ShowAllToggle({
	count,
	expanded,
	limit,
	onToggle,
	collapseLabel,
	expandLabel,
}: {
	count: number;
	expanded: boolean;
	limit: number;
	onToggle: () => void;
	collapseLabel: string;
	expandLabel: string;
}) {
	if (count <= limit) return null;
	return (
		<button
			aria-expanded={expanded}
			className="text-link"
			onClick={onToggle}
			type="button"
		>
			{expanded ? collapseLabel : expandLabel}
		</button>
	);
}
export function TableScroll({
	children,
	label = "可横向滚动的表格",
}: {
	children: ReactNode;
	label?: string;
}) {
	return (
		<section
			aria-label={label}
			className="table-scroll"
			// biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard users need to scroll wide tables without interactive cells.
			tabIndex={0}
		>
			{children}
		</section>
	);
}
export function Modal({
	error,
	title,
	onClose,
	children,
	className = "",
	busy = false,
}: {
	title: string;
	error?: string | null;
	onClose: () => void;
	children: ReactNode;
	className?: string;
	busy?: boolean;
}) {
	const dialogRef = useRef<HTMLDialogElement>(null);
	const titleId = useId();
	useEffect(() => {
		const dialog = dialogRef.current;
		const previousFocus = document.activeElement;
		const previousOverflow = document.body.style.overflow;
		document.body.style.overflow = "hidden";
		dialog?.showModal();
		const control = dialog?.querySelector<HTMLElement>(
			"input:not([disabled]), textarea:not([disabled]), [role=combobox]:not([disabled])",
		);
		control?.focus();
		return () => {
			dialog?.close();
			document.body.style.overflow = previousOverflow;
			if (previousFocus instanceof HTMLElement && previousFocus.isConnected)
				previousFocus.focus();
		};
	}, []);
	return (
		<dialog
			aria-busy={busy}
			aria-labelledby={titleId}
			className={`modal ${className}`}
			onCancel={(event) => {
				event.preventDefault();
				if (!busy) onClose();
			}}
			ref={dialogRef}
		>
			<div className="modal-heading">
				<h2 id={titleId}>{title}</h2>
				<button
					aria-label="关闭弹窗"
					className="icon-button"
					disabled={busy}
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
export function Transaction({
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
