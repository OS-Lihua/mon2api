import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { Token2ApiAdmin } from "~/app/_components/token2api-admin";

const { statusQuery } = vi.hoisted(() => ({
	statusQuery: vi.fn(() => ({
		data: undefined,
		error: null,
		isFetching: false,
		refetch: vi.fn(),
	})),
}));
vi.mock("~/shared/ui-preview", () => ({ uiPreview: true }));
vi.mock("~/trpc/react", () => ({
	api: {
		token2api: {
			snapshot: {
				useQuery: () => ({
					data: {
						viewer: {
							address: "0x0000000000000000000000000000000000000001",
							demo: true,
						},
					},
					refetch: vi.fn(),
				}),
			},
			operatorStatus: { useQuery: statusQuery },
		},
	},
}));
vi.mock("~/app/_components/wallet-provider", () => ({
	useToken2ApiWallet: () => ({ address: undefined, isConnected: false }),
}));
vi.mock("@rainbow-me/rainbowkit", () => ({
	ConnectButton: () => {
		throw new Error("Preview has no Wagmi provider");
	},
}));

it("keeps the admin preview readable without a wallet provider or protected queries", () => {
	const html = renderToStaticMarkup(createElement(Token2ApiAdmin));
	expect(html).toContain("预览模式不执行管理员操作");
	expect(html).not.toContain("新增地址");
	expect(statusQuery).toHaveBeenCalledWith(
		undefined,
		expect.objectContaining({ enabled: false }),
	);
});
