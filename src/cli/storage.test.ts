import { chmod, lstat, mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	CliStore,
	decryptSecret,
	encryptSecret,
	readPrivate,
	writePrivate,
} from "./storage";

const directories: string[] = [];
afterEach(async () => {
	await Promise.all(
		directories
			.splice(0)
			.map((directory) => rm(directory, { recursive: true, force: true })),
	);
});
async function temporary() {
	const directory = await mkdtemp(path.join(tmpdir(), "token2api-cli-"));
	directories.push(directory);
	return directory;
}

describe("local CLI secret storage", () => {
	it("encrypts without plaintext, randomizes ciphertext and authenticates password, contents and context", () => {
		const payload = {
			privateKey: "test-only-private-secret",
			apiKey: "private-upstream-secret",
		};
		const record = encryptSecret(
			payload,
			"test-password-at-least-12",
			"wallet",
		);
		expect(JSON.stringify(record)).not.toContain(payload.privateKey);
		expect(JSON.stringify(record)).not.toContain(payload.apiKey);
		expect(
			decryptSecret(record, "test-password-at-least-12", "wallet"),
		).toEqual(payload);
		expect(
			encryptSecret(payload, "test-password-at-least-12", "wallet").ciphertext,
		).not.toBe(record.ciphertext);
		for (const action of [
			() => decryptSecret(record, "wrong-password", "wallet"),
			() =>
				decryptSecret(record, "test-password-at-least-12", "other-platform"),
			() =>
				decryptSecret(
					{ ...record, ciphertext: `ff${record.ciphertext.slice(2)}` },
					"test-password-at-least-12",
					"wallet",
				),
		])
			expect(action).toThrow();
	});
	it("writes owner-only files atomically and rejects open permissions and symlinks", async () => {
		const directory = await temporary();
		const file = path.join(directory, "profile", "secret.json");
		await writePrivate(file, { fixture: "private" });
		expect(await readPrivate(file)).toEqual({ fixture: "private" });
		expect((await lstat(file)).mode & 0o777).toBe(0o600);
		expect((await lstat(path.dirname(file))).mode & 0o777).toBe(0o700);
		await symlink(file, path.join(directory, "link.json"));
		await expect(
			readPrivate(path.join(directory, "link.json")),
		).rejects.toThrow();
		await chmod(file, 0o644);
		await expect(readPrivate(file)).rejects.toMatchObject({
			code: "insecure_permissions",
		});
	});
	it("binds management cookies to the platform and expiration, and prevents profile traversal", async () => {
		const store = new CliStore("default", await temporary());
		await writePrivate(store.file("session.json"), {
			platform: "https://platform.example",
			address: `0x${"11".repeat(20)}`,
			cookie: "token2api_session=private-cookie",
			expiresAt: Date.now() + 60_000,
		});
		expect((await store.session("https://platform.example")).address).toBe(
			`0x${"11".repeat(20)}`,
		);
		await expect(store.session("https://other.example")).rejects.toMatchObject({
			code: "authentication_required",
		});
		expect(() => new CliStore("../other", store.directory)).toThrow();
		await store.logout();
		await expect(readFile(store.file("session.json"))).rejects.toThrow();
	});
});
