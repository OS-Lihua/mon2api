import Image from "next/image";

export function BrandLogo({
	tone = "light",
	className,
}: {
	tone?: "light" | "dark";
	className?: string;
}) {
	return (
		<Image
			alt="Token2API"
			className={`brand-logo ${className ?? ""}`}
			height={60}
			loading="eager"
			src={`/brand/logo-${tone}.svg`}
			unoptimized
			width={272}
		/>
	);
}
