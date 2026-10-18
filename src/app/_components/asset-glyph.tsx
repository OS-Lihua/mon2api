import { Coins } from "lucide-react";

/** Settlement asset mark. Unknown symbols render as a native-coin icon. */
export function AssetGlyph({
	symbol,
	size = 14,
}: {
	symbol: string;
	size?: number;
}) {
	const kind = symbol.toUpperCase();
	if (kind === "USDT")
		return (
			<svg aria-hidden="true" height={size} viewBox="0 0 24 24" width={size}>
				<circle cx="12" cy="12" fill="#26a17b" r="11" />
				<path d="M6.8 6.2h10.4v2.6h-3.8v9.6h-2.8V8.8H6.8Z" fill="#fff" />
				<ellipse
					cx="12"
					cy="12.2"
					fill="none"
					rx="5.6"
					ry="1.7"
					stroke="#fff"
					strokeWidth="1.2"
				/>
			</svg>
		);
	if (kind === "USDC")
		return (
			<svg aria-hidden="true" height={size} viewBox="0 0 24 24" width={size}>
				<circle cx="12" cy="12" fill="#2775ca" r="11" />
				<path
					d="M9 5.8a7 7 0 0 0 0 12.4M15 5.8a7 7 0 0 1 0 12.4"
					fill="none"
					stroke="#fff"
					strokeLinecap="round"
					strokeWidth="1.4"
				/>
				<text
					fill="#fff"
					fontFamily="Arial, sans-serif"
					fontSize="10"
					fontWeight="700"
					textAnchor="middle"
					x="12"
					y="15.6"
				>
					$
				</text>
			</svg>
		);
	return <Coins aria-hidden="true" size={size} />;
}
