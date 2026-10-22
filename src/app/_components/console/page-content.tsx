"use client";

import { createContext, type ReactNode, useContext } from "react";
import type { Section } from "./format";

// The shared layout owns wallet and operation state; each route selects its page.
export const ConsolePagesContext = createContext<Record<
	Section,
	ReactNode
> | null>(null);

export function ConsolePageContent({ section }: { section: Section }) {
	const pages = useContext(ConsolePagesContext);
	if (!pages) throw new Error("Console pages require the console layout.");
	return pages[section];
}
