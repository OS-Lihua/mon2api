import { beforeEach, describe, expect, it, vi } from "vitest";
import { assertEscrowOwnerGuard } from "../src/server/services/escrow-version";

const escrow = "0x1111111111111111111111111111111111111111";
const caller = "0x2222222222222222222222222222222222222222";
const call = vi.fn();
const client = { call };

describe("escrow deployment reuse", () => {
	beforeEach(() => {
		call.mockReset();
	});

	it("recognizes the owner guard without sending a transaction", async () => {
		call.mockRejectedValue(
			new Error("Execution reverted with reason: session owner mismatch."),
		);
		await expect(
			assertEscrowOwnerGuard(client, escrow, caller),
		).resolves.toBeUndefined();
		const input = call.mock.calls[0]?.[0];
		expect(input).toMatchObject({ to: escrow, account: caller });
	});

	it("rejects a deployment that does not enforce session ownership", async () => {
		call.mockRejectedValue(
			new Error("Execution reverted", {
				cause: new Error("Execution reverted with reason: invalid terms."),
			}),
		);
		await expect(
			assertEscrowOwnerGuard(client, escrow, caller),
		).rejects.toThrow("could not be verified");
	});

	it("fails closed on a successful call or RPC error", async () => {
		call
			.mockResolvedValueOnce({ data: "0x" })
			.mockRejectedValueOnce(new Error("RPC unavailable"));
		await expect(
			assertEscrowOwnerGuard(client, escrow, caller),
		).rejects.toThrow("guard is absent");
		await expect(
			assertEscrowOwnerGuard(client, escrow, caller),
		).rejects.toThrow("could not be verified");
	});
});
