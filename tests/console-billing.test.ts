import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BillingSection } from "~/app/_components/console/billing-section";
import { requestUsagePending } from "~/app/_components/console/format";
import type { RequestView, Snapshot } from "~/shared/token2api";
import { previewSnapshot } from "~/shared/ui-preview";

const request: RequestView = {
	id: "review-request",
	sessionId: "review-session",
	listingName: "Review resource",
	model: "review-model",
	status: "REVIEW",
	inputTokens: null,
	outputTokens: null,
	cost: 0,
	usageSource: "pending",
	upstreamRequestId: null,
	createdAt: "2026-10-22T00:00:00.000Z",
	settled: false,
};
function requestLedger(override: Partial<RequestView>) {
	const data: Snapshot = {
		...previewSnapshot,
		requests: [{ ...request, ...override }],
		settlements: [],
		sessions: [],
	};
	const noop = () => {};
	const html = renderToStaticMarkup(
		createElement(BillingSection, {
			data,
			busy: false,
			focusRequests: false,
			onConfirm: noop,
			onFocused: noop,
			onRefund: noop,
			onSelfClose: noop,
			onSettle: noop,
			onWithdraw: noop,
		}),
	);
	return html.slice(
		html.indexOf('id="billing-requests"'),
		html.indexOf('id="billing-settlements"'),
	);
}
describe("billing usage uncertainty", () => {
	it.each(["REVIEW", "PENDING_USAGE", "RUNNING"])(
		"retains uncertain %s fees even if stale settlement flags are present",
		(status) => {
			const ledger = requestLedger({
				status,
				settled: true,
				inputTokens: 50,
				outputTokens: 20,
			});
			expect(ledger).toContain("待核对");
			expect(ledger).not.toContain("0.000000");
			expect(ledger.slice(ledger.indexOf("<tbody>"))).not.toContain("已结算");
		},
	);
	it("does not treat a completed response with missing usage as a zero charge", () => {
		expect(requestUsagePending({ ...request, status: "COMPLETED" })).toBe(true);
		expect(requestLedger({ status: "COMPLETED" })).toContain(
			"待核对 · 保留预留",
		);
	});
	it("renders confirmed fees in the configured asset without rounding away micro-units", () => {
		const ledger = requestLedger({
			status: "COMPLETED",
			inputTokens: 1,
			outputTokens: 1,
			cost: 1,
			settled: true,
		});
		expect(ledger).toContain("费用（USDC）");
		expect(ledger).toContain("0.000001");
		expect(ledger).toContain("已结算");
		expect(ledger).not.toContain("保留预留");
	});
	it("preserves an explicitly failed request with released usage as a confirmed zero charge", () => {
		expect(requestUsagePending({ ...request, status: "FAILED" })).toBe(false);
		const ledger = requestLedger({ status: "FAILED" });
		expect(ledger).toContain("0.000000");
		expect(ledger).toContain("失败");
	});
});
