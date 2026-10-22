import type { Metadata } from "next";
import { ConsolePageContent } from "~/app/_components/console/page-content";
import { consoleRoutes } from "~/app/_components/console/routes";

export const metadata: Metadata = {
	title: `${consoleRoutes.billing.title} · Token2API`,
	description: consoleRoutes.billing.description,
};

export default function BillingPage() {
	return <ConsolePageContent section="billing" />;
}
