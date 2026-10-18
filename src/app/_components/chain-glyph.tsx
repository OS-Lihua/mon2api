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
const chainMonograms: Record<number, string> = {
	1: "E",
	8453: "B",
	42161: "AR",
	10: "OP",
	56: "BNB",
	137: "P",
	43114: "AV",
	4663: "RH",
};
export function ChainGlyph({
	id,
	className,
}: {
	id: number;
	className?: string;
}) {
	return (
		<span
			aria-hidden="true"
			className={className}
			style={{ color: chainColor(id) }}
		>
			{id === 1 ? (
				<svg
					aria-hidden="true"
					fill="currentColor"
					height="22"
					viewBox="0 0 24 24"
					width="22"
				>
					<path d="M12 2 5 12l7 4 7-4-7-10Z" />
					<path d="m5 14 7 8 7-8-7 4-7-4Z" opacity=".6" />
				</svg>
			) : (
				<span>{chainMonograms[id] ?? "EVM"}</span>
			)}
		</span>
	);
}
