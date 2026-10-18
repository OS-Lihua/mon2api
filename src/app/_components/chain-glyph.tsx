import type { ReactNode } from "react";

const chainColors: Record<number, string> = {
	1: "#62758b",
	8453: "#2563eb",
	42161: "#2b8cc4",
	10: "#e5484d",
	56: "#b9880b",
	137: "#8060ca",
	43114: "#d94747",
	4663: "#16865c",
};
export const chainColor = (id: number) => chainColors[id] ?? "#0f766e";
export const chainLabel = (id: number, name: string) =>
	id === 56
		? "BSC"
		: id === 10
			? "Optimism"
			: id === 42161
				? "Arbitrum"
				: id === 4663
					? "Robinhood"
					: name;
const chainMarks: Record<number, ReactNode> = {
	1: (
		<>
			<path d="M12 2 5 12l7 4 7-4-7-10Z" />
			<path d="m5 14 7 8 7-8-7 4-7-4Z" opacity=".6" />
		</>
	),
	8453: (
		<path d="M11.99 22C17.52 22 22 17.52 22 12S17.52 2 11.99 2C6.75 2 2.45 6.03 2.03 11.16h13.22v1.67H2.03C2.45 17.97 6.75 22 11.99 22Z" />
	),
	42161: (
		<g
			fill="none"
			stroke="currentColor"
			strokeLinecap="round"
			strokeLinejoin="round"
			strokeWidth="1.8"
		>
			<path d="m12 2.5 8.2 4.75v9.5L12 21.5l-8.2-4.75v-9.5L12 2.5Z" />
			<path d="m8 16.5 4-9 4 9" />
		</g>
	),
	10: (
		<>
			<circle cx="12" cy="12" r="10" />
			<text
				fill="#fff"
				fontFamily="Arial, sans-serif"
				fontSize="8.5"
				fontStyle="italic"
				fontWeight="800"
				textAnchor="middle"
				x="12"
				y="15"
			>
				OP
			</text>
		</>
	),
	56: (
		<path d="M12 3 17 8l-1.8 1.8L12 6.6 8.8 9.8 7 8l5-5Zm0 6.6 2.4 2.4-2.4 2.4L9.6 12 12 9.6ZM5.4 10.2 7.2 12l-1.8 1.8L3.6 12l1.8-1.8Zm13.2 0 1.8 1.8-1.8 1.8-1.8-1.8 1.8-1.8ZM12 21l-5-5 1.8-1.8 3.2 3.2 3.2-3.2L17 16l-5 5Z" />
	),
	137: (
		<path
			d="M10.4 9.6 7.2 7.8 3.8 9.8v4.4l3.4 2 3.4-2V9.8l3.4-2 3.4 2v4.4l-3.4 2-3.2-1.8"
			fill="none"
			stroke="currentColor"
			strokeLinejoin="round"
			strokeWidth="1.9"
		/>
	),
	43114: (
		<>
			<circle cx="12" cy="12" r="10" />
			<path
				d="M7.7 16.5h3.4c.4 0 .7-.2.9-.5l1.6-2.7a1 1 0 0 0 0-1l-2-3.5a.75.75 0 0 0-1.3 0l-3.3 6.6c-.3.5.1 1.1.7 1.1Zm6.6 0h2.9c.6 0 .9-.6.6-1.1l-1.4-2.5a.75.75 0 0 0-1.3 0l-1.4 2.5c-.3.5.1 1.1.6 1.1Z"
				fill="#fff"
			/>
		</>
	),
	4663: (
		<path d="M19.5 2.5c-6.3 1-11.4 5.6-13 12.4L5 21.5l1.7-.6 1.3-4.3c2.4-.3 4.6-1.4 6-3.2l-3.1.2 4.4-2.6c2-1.8 3.5-4.2 4.2-8.5Z" />
	),
};
export function ChainGlyph({
	id,
	className,
}: {
	id: number;
	className?: string;
}) {
	const mark = chainMarks[id];
	return (
		<span
			aria-hidden="true"
			className={className}
			style={{ color: chainColor(id) }}
		>
			{mark ? (
				<svg
					aria-hidden="true"
					fill="currentColor"
					height="22"
					viewBox="0 0 24 24"
					width="22"
				>
					{mark}
				</svg>
			) : (
				<span>EVM</span>
			)}
		</span>
	);
}
