import type { Metadata } from "next";
import { ConsolePageContent } from "~/app/_components/console/page-content";
import { consoleRoutes } from "~/app/_components/console/routes";

export const metadata: Metadata = {
	title: `${consoleRoutes.lab.title} · Token2API`,
	description: consoleRoutes.lab.description,
};

export default function LabPage() {
	return <ConsolePageContent section="lab" />;
}
