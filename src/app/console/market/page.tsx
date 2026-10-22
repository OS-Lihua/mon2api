import type { Metadata } from "next";
import { ConsolePageContent } from "~/app/_components/console/page-content";
import { consoleRoutes } from "~/app/_components/console/routes";

export const metadata: Metadata = {
	title: `${consoleRoutes.market.title} · Token2API`,
	description: consoleRoutes.market.description,
};

export default function MarketPage() {
	return <ConsolePageContent section="market" />;
}
