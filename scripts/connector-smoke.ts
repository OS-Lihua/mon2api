import "dotenv/config";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import { PrismaClient } from "@prisma/client";
import { ConnectorClient } from "../src/connector/client";
import { connectorPayload } from "../src/shared/connector";

async function listen(server: Server) {
	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => resolve());
	});
	const address = server.address();
	if (!address || typeof address === "string")
		throw new Error("Missing test server port");
	return `http://127.0.0.1:${address.port}`;
}
async function close(server: Server) {
	server.closeAllConnections();
	await new Promise<void>((resolve, reject) =>
		server.close((error) => (error ? reject(error) : resolve())),
	);
}
const databaseUrl = new URL(process.env.DATABASE_URL ?? "");
if (!["127.0.0.1", "localhost", "[::1]"].includes(databaseUrl.hostname))
	throw new Error("Connector smoke only supports a local test database.");
const namespace = `connector_smoke_${randomBytes(8).toString("hex")}`;
const admin = new PrismaClient();
databaseUrl.searchParams.set("schema", namespace);
process.env.DATABASE_URL = databaseUrl.toString();

let upstreamCalls = 0;
const upstreamKey = "test-only-upstream-credential";
const upstream = createServer(async (req, res) => {
	try {
		if (req.url === "/custom/openai/models") {
			assert.equal(req.headers.authorization, `Bearer ${upstreamKey}`);
			res.writeHead(200, { "Content-Type": "application/json" });
			res.end(
				JSON.stringify({
					data: [{ id: "local-test-model", privateMetadata: "not-uploaded" }],
				}),
			);
			return;
		}
		assert.equal(req.url, "/custom/openai/chat/completions");
		assert.equal(req.headers.authorization, `Bearer ${upstreamKey}`);
		let body = "";
		for await (const chunk of req) body += chunk;
		const input = JSON.parse(body);
		assert.equal(input.model, "local-test-model");
		upstreamCalls++;
		res.writeHead(200, {
			"Content-Type": "text/event-stream",
			"x-request-id": "local-smoke-request",
		});
		res.write(
			`data: ${JSON.stringify({ id: "chatcmpl-smoke", choices: [{ index: 0, delta: { content: "local connector works" }, finish_reason: null }] })}\n\n`,
		);
		await delay(2100);
		res.end(
			`data: ${JSON.stringify({ id: "chatcmpl-smoke", choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 } })}\n\ndata: [DONE]\n\n`,
		);
	} catch {
		res.writeHead(500);
		res.end();
	}
});
let platform: Server | undefined;
let appDb: PrismaClient | undefined;
let connectorProcess: ReturnType<typeof spawn> | undefined;
let running: Promise<number | null> | undefined;
const logs: string[] = [];
try {
	await admin.$executeRawUnsafe(`CREATE SCHEMA "${namespace}"`);
	const migration = spawnSync(
		process.execPath,
		["node_modules/prisma/build/index.js", "migrate", "deploy"],
		{ env: process.env, encoding: "utf8" },
	);
	assert.equal(migration.status, 0, "Isolated schema migration failed");
	const [{ db }, service, routes] = await Promise.all([
		import("../src/server/db"),
		import("../src/server/services/local-connector"),
		import("../src/server/rest/local-connector"),
	]);
	appDb = db;
	const routeMap: Record<string, (request: Request) => Promise<Response>> = {
		"/api/v1/connector/poll": routes.pollConnectorPost,
		"/api/v1/connector/connect": routes.connectConnectorPost,
		"/api/v1/connector/catalog": routes.catalogConnectorPost,
		"/api/v1/connector/updates": routes.updateConnectorPost,
		"/api/v1/connector/status": routes.connectorStatusGet,
		"/api/v1/connector/disconnect": routes.disconnectConnectorPost,
	};
	platform = createServer(async (req, res) => {
		try {
			const route = routeMap[req.url ?? ""];
			if (!route) {
				res.writeHead(404);
				res.end();
				return;
			}
			let body = "";
			for await (const chunk of req) body += chunk;
			const headers = new Headers();
			for (const [name, value] of Object.entries(req.headers)) {
				if (value !== undefined)
					headers.set(name, Array.isArray(value) ? value.join(",") : value);
			}
			const response = await route(
				new Request(`http://127.0.0.1${req.url}`, {
					method: req.method,
					headers,
					...(body ? { body } : {}),
				}),
			);
			res.writeHead(response.status, Object.fromEntries(response.headers));
			res.end(Buffer.from(await response.arrayBuffer()));
		} catch {
			res.writeHead(500);
			res.end();
		}
	});
	const [platformUrl, upstreamUrl] = await Promise.all([
		listen(platform),
		listen(upstream),
	]);
	const input = {
		kind: "gateway" as const,
		name: "Isolated local connector",
		description: "Integration smoke fixture",
		model: "local-test-model",
		inputRate: 1000000,
		outputRate: 1000000,
		concurrency: 1 as const,
	};
	const seller = {
		address: `0x${"11".repeat(20)}`,
		name: "Test seller",
		demo: false,
	};
	const created = await service.createLocalDraft(seller, {
		name: input.name,
		description: input.description,
		kind: input.kind,
		concurrency: input.concurrency,
	});
	const launch = await service.createConnectorLaunch(seller, created.id);
	const exchanges = await Promise.allSettled([
		ConnectorClient.connect(platformUrl, launch.code),
		ConnectorClient.connect(platformUrl, launch.code),
	]);
	const accepted = exchanges.filter((result) => result.status === "fulfilled");
	assert.equal(accepted.length, 1, "A launch code must only be consumed once");
	const first = accepted[0];
	assert.ok(first?.status === "fulfilled");
	const connectorToken = first.value;
	const client = new ConnectorClient(platformUrl, connectorToken);
	await assert.rejects(
		new ConnectorClient(platformUrl, created.token).status(),
		/HTTP 401/,
	);
	const expired = await service.createConnectorLaunch(seller, created.id);
	await db.listing.update({
		where: { id: created.id },
		data: { connectorLaunchExpiresAt: new Date(0) },
	});
	await assert.rejects(
		ConnectorClient.connect(platformUrl, expired.code),
		/HTTP 401/,
	);
	const listing = await db.listing.findUniqueOrThrow({
		where: { id: created.id },
	});
	assert.equal(listing.secret, null);
	assert.equal(listing.baseUrl, null);
	assert.notEqual(listing.connectorHash, created.token);
	const commerce = await import("../src/server/services/commerce");
	assert.equal((await commerce.listResources({ limit: 20 })).data.length, 0);
	await assert.rejects(
		service.connectorSetup(
			{ ...seller, address: `0x${"55".repeat(20)}` },
			created.id,
		),
	);
	connectorProcess = spawn(
		process.execPath,
		[
			"--import",
			"tsx",
			"scripts/connector.ts",
			"start",
			"--platform",
			platformUrl,
			"--upstream",
			`${upstreamUrl}/custom/openai`,
			"--credentials-stdin",
		],
		{ stdio: ["pipe", "pipe", "pipe"], env: process.env },
	);
	running = new Promise((resolve) => {
		connectorProcess?.once("error", () => resolve(-1));
		connectorProcess?.once("exit", (code) => resolve(code));
	});
	connectorProcess.stdout?.on("data", (chunk) => logs.push(String(chunk)));
	connectorProcess.stderr?.on("data", (chunk) => logs.push(String(chunk)));
	connectorProcess.stdin?.end(
		JSON.stringify({ token: connectorToken, apiKey: upstreamKey }),
	);

	for (let i = 0; i < 40; i++) {
		if (
			(await client.status()).online &&
			(await service.connectorSetup(seller, created.id)).models.length
		)
			break;
		await delay(100);
	}
	assert.equal((await client.status()).online, true);
	const setup = await service.connectorSetup(seller, created.id);
	assert.equal(setup.status, "DISCOVERING");
	assert.equal(setup.model, "");
	assert.deepEqual(setup.models, [input.model]);
	await assert.rejects(
		service.publishLocalDraft(seller, {
			id: created.id,
			model: "invented-model",
			inputRate: input.inputRate,
			outputRate: input.outputRate,
		}),
	);
	await service.publishLocalDraft(seller, {
		id: created.id,
		model: input.model,
		inputRate: input.inputRate,
		outputRate: input.outputRate,
	});
	const lease = await db.lease.create({
		data: {
			id: `0x${"22".repeat(32)}`,
			listingId: created.id,
			consumer: `0x${"33".repeat(20)}`,
			provider: seller.address,
			model: input.model,
			inputRate: input.inputRate,
			outputRate: input.outputRate,
			termsHash: `0x${"44".repeat(32)}`,
			budget: 1000000,
			expiresAt: new Date(Date.now() + 3600000),
		},
	});
	const request = await db.meterRequest.create({
		data: {
			sessionId: lease.id,
			idempotencyKey: "connector-smoke-0001",
			reservation: 100000,
		},
	});
	const payload = connectorPayload.parse({
		model: input.model,
		messages: [{ role: "user", content: "hello" }],
		maxTokens: 128,
		conversationId: "a".repeat(64),
	});
	let text = "";
	const result = await service.runLocalConnector(
		created.id,
		request.id,
		{ kind: "gateway", ...payload },
		(delta) => {
			text += delta;
		},
		AbortSignal.timeout(15000),
	);
	assert.equal(text, "local connector works");
	assert.equal(result.inputTokens, 3);
	assert.equal(result.outputTokens, 4);
	assert.equal(result.pendingReview, false);
	assert.equal(upstreamCalls, 1);
	assert.equal(
		(
			await db.connectorJob.findUniqueOrThrow({
				where: { requestId: request.id },
			})
		).status,
		"COMPLETE",
	);
	assert.equal(
		JSON.stringify(await db.connectorJob.findMany()).includes(upstreamKey),
		false,
	);
	assert.equal(logs.join(" ").includes(upstreamKey), false);
	const stolen = await fetch(`${platformUrl}/api/v1/connector/poll`, {
		method: "POST",
		headers: {
			authorization: "Bearer t2a_not-a-connector",
			"content-type": "application/json",
		},
		body: JSON.stringify({ model: input.model }),
	});
	assert.equal(stolen.status, 401);
	connectorProcess.kill("SIGTERM");
	assert.equal(await running, 0);
	assert.equal((await client.status()).online, false);
	await service.rotateConnector(seller, created.id);
	await assert.rejects(client.status(), /HTTP 401/);
	console.log(
		"PASS: one-time launch exchange, concurrent replay rejection, expiration, isolated migrations, private unpublished draft, automatic model discovery, explicit model publication, CLI subprocess, real HTTP/SSE, resource credential, local-only upstream key, one dispatch, streamed output, final usage, disconnect and revocation. No external model or chain transaction.",
	);
} finally {
	connectorProcess?.kill("SIGTERM");
	await running;
	if (platform) await close(platform);
	if (upstream.listening) await close(upstream);
	await appDb?.$disconnect();
	await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${namespace}" CASCADE`);
	await admin.$disconnect();
}
