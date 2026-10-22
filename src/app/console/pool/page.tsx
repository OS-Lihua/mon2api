import type { Metadata } from "next";
import { ConsolePageContent } from "~/app/_components/console/page-content";
import { consoleRoutes } from "~/app/_components/console/routes";

export const metadata: Metadata = {
	title: `${consoleRoutes.pool.title} · Token2API`,
	description: consoleRoutes.pool.description,
};

export default function PoolPage() {
	return <ConsolePageContent section="pool" />;
}
