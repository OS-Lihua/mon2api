import { createTRPCClient } from "@trpc/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppRouter } from "~/server/api/root";
import { previewLink } from "./preview-link";

afterEach(() => {
	vi.unstubAllGlobals();
	vi.unstubAllEnvs();
	vi.resetModules();
});

describe("frontend preview isolation", () => {
	it.each([
		["production", "true", false],
		["test", "true", false],
		["development", undefined, false],
		["development", "false", false],
		["development", "true", true],
	] as const)(
		"enables preview only for explicit development opt-in (%s, %s)",
		async (mode, flag, enabled) => {
			vi.stubEnv("NODE_ENV", mode);
			vi.stubEnv("NEXT_PUBLIC_UI_PREVIEW", flag);
			vi.resetModules();
			const { uiPreview } = await import("~/shared/ui-preview");
			expect(uiPreview).toBe(enabled);
		},
	);

	it("serves labelled resources without network requests or invented balances", async () => {
		const fetch = vi.fn();
		vi.stubGlobal("fetch", fetch);
		const client = createTRPCClient<AppRouter>({ links: [previewLink] });
		const result = await client.mon2api.snapshot.query({ gatewayOnly: true });
		expect(result.network.ready).toBe(false);
		expect(result.metrics.walletBalance).toBeNull();
		expect(result.metrics.claimable).toBeNull();
		expect(result.listings).toHaveLength(3);
		expect(
			result.listings.every(
				(item) => item.kind === "demo" && item.description.includes("UI 预览"),
			),
		).toBe(true);
		expect(fetch).not.toHaveBeenCalled();
	});

	it("rejects writes and other requests before any backend transport", async () => {
		const fetch = vi.fn();
		vi.stubGlobal("fetch", fetch);
		const client = createTRPCClient<AppRouter>({ links: [previewLink] });
		await expect(client.mon2api.logout.mutate()).rejects.toThrow(
			"UI 预览模式不执行后端操作。",
		);
		await expect(
			client.mon2api.createKey.mutate({
				sessionId: "preview-only",
				name: "preview",
			}),
		).rejects.toThrow("UI 预览模式不执行后端操作。");
		expect(fetch).not.toHaveBeenCalled();
	});
});
