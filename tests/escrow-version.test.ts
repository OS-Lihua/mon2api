import { beforeEach, describe, expect, it, vi } from "vitest";
import { inspectEscrowOwnerGuard } from "../src/server/services/escrow-version";

const escrow = "0x1111111111111111111111111111111111111111";
const caller = "0x2222222222222222222222222222222222222222";
const call = vi.fn();
const client = { call } as Parameters<typeof inspectEscrowOwnerGuard>[0];

describe("escrow deployment reuse", () => {
	beforeEach(() => {
		call.mockReset();
	});

	it("recognizes the owner guard without sending a transaction", async () => {
		call.mockRejectedValue(
			new Error("Execution reverted with reason: session owner mismatch."),
		);
		await expect(inspectEscrowOwnerGuard(client, escrow, caller)).resolves.toBe(
			"guarded",
		);
		const input = call.mock.calls[0]?.[0];
		expect(input).toMatchObject({ to: escrow, account: caller });
	});

	it("recognizes an older escrow with the same deployment terms", async () => {
		call.mockRejectedValue(
			new Error("Execution reverted", {
				cause: new Error("Execution reverted with reason: invalid terms."),
			}),
		);
		await expect(inspectEscrowOwnerGuard(client, escrow, caller)).resolves.toBe(
			"legacy",
		);
	});

	it("fails closed on a successful call or RPC error", async () => {
		call
			.mockResolvedValueOnce({ data: "0x" })
			.mockRejectedValueOnce(new Error("RPC unavailable"));
		await expect(
			inspectEscrowOwnerGuard(client, escrow, caller),
		).rejects.toThrow("guard is absent");
		await expect(
			inspectEscrowOwnerGuard(client, escrow, caller),
		).rejects.toThrow("could not be verified");
	});
});
