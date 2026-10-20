import { randomUUID } from "node:crypto";
import { parseArgs } from "node:util";
import { mnemonicToAccount } from "viem/accounts";
import { parseSiweMessage } from "viem/siwe";
import { z } from "zod";
import * as c from "../src/server/services/commerce.schema";

// Public test identities are permitted only after verifying the loopback chain.
const { values } = parseArgs({
	options: { origin: { type: "string", default: "http://localhost:3000" } },
});
const target = new URL(values.origin);
if (
	target.protocol !== "http:" ||
	!["localhost", "127.0.0.1", "[::1]"].includes(target.hostname) ||
	target.username ||
	target.password ||
	target.pathname !== "/" ||
	target.search ||
	target.hash
)
	throw new Error("API smoke requires an HTTP loopback origin");
const origin = target.origin;
const mnemonic = "test test test test test test test test test test test junk";
function check(value: unknown, message: string): asserts value {
	if (!value) throw new Error(message);
}
async function send(
	path: string,
	body?: unknown,
	cookie = "",
	headers: Record<string, string> = {},
) {
	return fetch(`${origin}/api/v1${path}`, {
		method: body === undefined ? "GET" : "POST",
		redirect: "error",
		signal: AbortSignal.timeout(45_000),
		headers: {
			origin,
			"content-type": "application/json",
			...(cookie ? { cookie } : {}),
			...headers,
		},
		...(body === undefined ? {} : { body: JSON.stringify(body) }),
	});
}
async function read<T extends z.ZodTypeAny>(
	response: Response,
	schema: T,
): Promise<z.infer<T>> {
	if (!response.ok) {
		const error = z
			.object({ error: z.object({ code: z.string() }) })
			.safeParse(await response.json());
		throw new Error(
			`REST returned HTTP ${response.status}${error.success ? ` (${error.data.error.code})` : ""}`,
		);
	}
	check(
		response.headers.get("cache-control") === "no-store",
		"Missing no-store header",
	);
	return schema.parse(await response.json());
}
async function login(index: number) {
	const account = mnemonicToAccount(mnemonic, { addressIndex: index });
	const { message } = await read(
		await send("/auth/challenge", { address: account.address }),
		c.challengeResponse,
	);
	const siwe = parseSiweMessage(message);
	check(
		siwe.chainId === 31337 &&
			siwe.uri === origin &&
			siwe.domain === target.host,
		"Refusing a non-local sign-in message",
	);
	const signature = await account.signMessage({ message });
	const response = await send("/auth/login", {
		address: account.address,
		message,
		signature,
	});
	const viewer = await read(response, c.viewerResponse);
	check(
		viewer.address === account.address.toLowerCase(),
		"Wrong signed-in identity",
	);
	const cookie = response.headers
		.getSetCookie()
		.map((value) => value.split(";", 1)[0])
		.find((value) => value?.startsWith("token2api_session="));
	check(cookie, "Missing wallet session cookie");
	check(
		(
			await send("/auth/login", {
				address: account.address,
				message,
				signature,
			})
		).status === 401,
		"SIWE challenge replay was accepted",
	);
	return cookie;
}
async function main() {
	const network = await read(await send("/network"), c.networkResponse);
	check(
		network.mode === "local" && network.chainId === 31337 && network.ready,
		"Refusing to run outside ready local chain 31337",
	);
	const rpc = new URL(network.rpcUrl);
	check(
		rpc.protocol === "http:" &&
			["localhost", "127.0.0.1", "[::1]"].includes(rpc.hostname),
		"Refusing non-loopback RPC",
	);
	const rpcResponse = await fetch(rpc, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({
			jsonrpc: "2.0",
			id: 1,
			method: "eth_chainId",
			params: [],
		}),
		signal: AbortSignal.timeout(10_000),
	});
	const rpcBody = z
		.object({ result: z.literal("0x7a69") })
		.parse(await rpcResponse.json());
	check(rpcBody.result === "0x7a69", "Unexpected RPC chain");
	console.log("PASS loopback app and chain verified");
	const merchant = await login(1),
		consumer = await login(0);
	console.log("PASS both wallets log in over REST; nonce replay rejected");
	check(
		(await send("/merchant/resources")).status === 401,
		"Anonymous management access allowed",
	);
	check(
		(
			await send("/merchant/resources", undefined, merchant, {
				authorization: "Bearer inference-key",
			})
		).status === 401,
		"Inference key promoted to management",
	);
	const suffix = randomUUID();
	const created = await read(
		await send(
			"/merchant/resources",
			{
				name: `REST smoke ${suffix.slice(0, 8)}`,
				description: `Local API smoke ${suffix}`,
				model: "token2api-demo",
				kind: "demo",
				inputRate: 1_000_000,
				outputRate: 2_000_000,
				concurrency: 2,
			},
			merchant,
		),
		c.idResponse,
	);
	let cleanupError: unknown;
	try {
		const own = await read(
			await send(`/merchant/resources/${created.id}`, undefined, merchant),
			c.resourceResponse,
		);
		check(
			!("secret" in own) && !("baseUrl" in own),
			"Connector details leaked",
		);
		check(
			(await send(`/merchant/resources/${created.id}`, undefined, consumer))
				.status === 404,
			"Merchant resource ownership bypass",
		);
		check(
			(
				await send(
					`/merchant/resources/${created.id}`,
					{ inputRate: 7 },
					consumer,
				)
			).status === 404,
			"Merchant write ownership bypass",
		);
		await read(
			await send(
				`/merchant/resources/${created.id}`,
				{ inputRate: 3_000_000, concurrency: 3 },
				merchant,
			),
			c.okResponse,
		);
		check(
			(
				await send(
					`/merchant/resources/${created.id}`,
					{ concurrency: 4 },
					merchant,
					{ origin: "https://attacker.example" },
				)
			).status === 403,
			"Cross-origin management write allowed",
		);
		const updated = await read(
			await send(`/merchant/resources/${created.id}`, undefined, merchant),
			c.resourceResponse,
		);
		check(
			updated.inputRate === 3_000_000 && updated.concurrency === 3,
			"Resource edit not persisted or blocked write changed it",
		);
		console.log(
			"PASS owned resource create/read/edit; cross-wallet and origin rejection",
		);
		const visible = await read(
			await send(
				`/resources?q=${encodeURIComponent(suffix.slice(0, 8))}&limit=1`,
			),
			c.pageResponse(c.resourceResponse),
		);
		check(
			visible.data.some((row) => row.id === created.id),
			"Published resource missing from discovery",
		);
		check(
			(await send("/resources?limit=101")).status === 400,
			"Unbounded page accepted",
		);
		console.log("PASS paginated resource discovery and query validation");
		for (const [path, schema] of [
			["/consumer/sessions", c.pageResponse(c.sessionResponse)],
			["/consumer/keys", c.pageResponse(c.keyResponse)],
			["/consumer/requests", c.pageResponse(c.requestResponse)],
			["/consumer/settlements", c.pageResponse(c.settlementResponse)],
			["/merchant/requests", c.pageResponse(c.requestResponse)],
			["/merchant/settlements", c.pageResponse(c.settlementResponse)],
		] as const)
			await read(
				await send(
					path,
					undefined,
					path.startsWith("/merchant") ? merchant : consumer,
				),
				schema,
			);
		await read(
			await send("/account/balances", undefined, consumer),
			c.balancesResponse,
		);
		check(
			(await send("/requests/lookup?idempotency_key=unaccepted-request"))
				.status === 401,
			"Unauthenticated usage lookup allowed",
		);
		console.log(
			"PASS consumer and merchant ledger contracts; balances and usage auth",
		);
		const specification = z
			.object({ paths: z.record(z.unknown()) })
			.parse(await (await send("/openapi.json")).json());
		check(
			"/merchant/resources" in specification.paths &&
				"/consumer/sessions" in specification.paths,
			"Live OpenAPI missing commerce endpoints",
		);
		console.log("PASS live OpenAPI includes management API");
	} finally {
		try {
			await read(
				await send(
					`/merchant/resources/${created.id}/status`,
					{ enabled: false },
					merchant,
				),
				c.okResponse,
			);
		} catch (error) {
			cleanupError = error;
		}
	}
	if (cleanupError) throw cleanupError;
	const page = await read(
		await send(`/resources?q=${encodeURIComponent(suffix.slice(0, 8))}`),
		c.pageResponse(c.resourceResponse),
	);
	check(
		!page.data.some((row) => row.id === created.id),
		"Paused smoke resource still public",
	);
	await read(await send("/auth/logout", {}, merchant), c.okResponse);
	await read(await send("/auth/logout", {}, consumer), c.okResponse);
	console.log("PASS smoke resource paused and sessions logged out");
	console.log(
		"REST API smoke passed. No inference or on-chain fund transactions were sent.",
	);
}
main().catch((error) => {
	console.error(error instanceof Error ? error.message : "API smoke failed");
	process.exitCode = 1;
});
