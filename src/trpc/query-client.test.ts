import { TRPCClientError } from "@trpc/client";
import { describe, expect, it } from "vitest";

import { retryTransient } from "./query-client";

const trpcError = (httpStatus: number) =>
	new TRPCClientError("failed", {
		result: {
			error: { message: "failed", code: -32000, data: { httpStatus } },
		},
	});

describe("retryTransient", () => {
	it.each([400, 401, 404, 409, 429])("does not retry HTTP %s", (status) => {
		expect(retryTransient(0, trpcError(status))).toBe(false);
	});

	it("retries server and network failures twice", () => {
		expect(retryTransient(0, trpcError(503))).toBe(true);
		expect(retryTransient(1, new Error("network"))).toBe(true);
		expect(retryTransient(2, new Error("network"))).toBe(false);
	});
});
