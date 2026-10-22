import type { Metadata } from "next";
import { ConsolePageContent } from "~/app/_components/console/page-content";
import { consoleRoutes } from "~/app/_components/console/routes";

export const metadata: Metadata = {
	title: `${consoleRoutes.keys.title} · Token2API`,
	description: consoleRoutes.keys.description,
};

export default function KeysPage() {
	return <ConsolePageContent section="keys" />;
}
