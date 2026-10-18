import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
	return {
		name: "Token2API · AI 资源多链结算平台",
		short_name: "Token2API",
		description:
			"面向 AI 资源交易的多链结算平台。锁定预算、按量计费，核对收入与退款。",
		start_url: "/",
		display: "standalone",
		background_color: "#f4f8f7",
		theme_color: "#0f766e",
		icons: [
			{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
			{ src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
			{ src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
			{
				src: "/icons/icon-maskable-512.png",
				sizes: "512x512",
				type: "image/png",
				purpose: "maskable",
			},
		],
	};
}
