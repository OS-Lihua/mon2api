import { mnemonicToAccount } from "viem/accounts";
import { createSiweMessage } from "viem/siwe";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ManagementClient, validateLoginMessage } from "./client";

const account = mnemonicToAccount(
	"test test test test test test test test test test test junk",
);
const platform = "http://127.0.0.1:3000";
function message(overrides = {}) {
	const issuedAt = new Date();
	return createSiweMessage({
		address: account.address,
		chainId: 31337,
		domain: "127.0.0.1:3000",
		uri: platform,
		version: "1",
		nonce: "12".repeat(24),
		issuedAt,
		expirationTime: new Date(issuedAt.getTime() + 300_000),
		statement:
			"Sign in to Token2API. This signature does not authorize token transfers.",
		...overrides,
	});
}
describe("CLI wallet signing and HTTP boundaries", () => {
	it("only accepts the exact domain, URI, chain, statement and bounded login lifetime", () => {
		expect(() =>
			validateLoginMessage(message(), account.address, platform, 31337),
		).not.toThrow();
		for (const value of [
			message({ domain: "evil.example" }),
			message({ uri: "https://evil.example" }),
			message({ chainId: 1 }),
			message({ statement: "Authorize spending" }),
			message({ expirationTime: new Date(Date.now() + 86400_000) }),
			"Sign arbitrary bytes",
		])
			expect(() =>
				validateLoginMessage(value, account.address, platform, 31337),
			).toThrow();
	});
	it("never forwards a stored cookie to another origin", () => {
		expect(
			() =>
				new ManagementClient("https://evil.example", {
					platform,
					address: account.address,
					cookie: "token2api_session=secret",
					expiresAt: Date.now() + 60000,
				}),
		).toThrow();
	});
	it("refuses redirects and reports uncertain mutations without retrying or printing private responses", async () => {
		const fetcher = vi
			.fn<typeof fetch>()
			.mockRejectedValue(new Error("private-url-and-key"));
		const client = new ManagementClient(platform, undefined, fetcher);
		await expect(
			client.request(
				"POST",
				"/merchant/resources",
				z.object({ id: z.string() }),
				{ apiKey: "secret-key" },
			),
		).rejects.toMatchObject({ code: "outcome_unknown", exitCode: 7 });
		expect(fetcher).toHaveBeenCalledTimes(1);
		expect(fetcher).toHaveBeenCalledWith(
			expect.any(String),
			expect.objectContaining({ redirect: "error" }),
		);
		fetcher.mockResolvedValue(
			new Response("private-response-contains-key", { status: 403 }),
		);
		await expect(
			client.request("GET", "/auth/me", z.object({})),
		).rejects.toMatchObject({ code: "forbidden", exitCode: 4 });
	});
});
