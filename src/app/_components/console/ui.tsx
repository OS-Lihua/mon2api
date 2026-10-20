"use client";

import {
	CircleHelp,
	ExternalLink,
	Layers3,
	type LucideIcon,
	X,
} from "lucide-react";
import { type ReactNode, useEffect, useRef } from "react";
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
export function TableScroll({ children }: { children: ReactNode }) {
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
export function Modal({
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
