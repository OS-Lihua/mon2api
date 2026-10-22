import {
	createCipheriv,
	createDecipheriv,
	randomBytes,
	scryptSync,
} from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, rename, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { z } from "zod";
import { CliError } from "./protocol";

const envelope = z
	.object({
		version: z.literal(1),
		context: z.string().max(4096),
		salt: z.string().regex(/^[a-f0-9]{32}$/),
		iv: z.string().regex(/^[a-f0-9]{24}$/),
		tag: z.string().regex(/^[a-f0-9]{32}$/),
		ciphertext: z
			.string()
			.regex(/^[a-f0-9]+$/)
			.max(131072),
	})
	.strict();
export const sessionSchema = z
	.object({
		platform: z.string().url(),
		address: z.string().regex(/^0x[\da-fA-F]{40}$/),
		cookie: z
			.string()
			.regex(/^token2api_session=[^;\s\r\n]+$/)
			.max(8192),
		expiresAt: z.number().int().positive(),
	})
	.strict();
export type LoginSession = z.infer<typeof sessionSchema>;

export function encryptSecret(
	value: unknown,
	password: string,
	context: string,
) {
	if (password.length < 12 || password.length > 1024)
		throw new CliError(
			"invalid_password",
			"加密密码至少 12 个字符，最多 1024 个字符。",
			2,
		);
	const salt = randomBytes(16);
	const iv = randomBytes(12);
	const key = scryptSync(password, salt, 32, {
		N: 65536,
		r: 8,
		p: 1,
		maxmem: 128 * 1024 * 1024,
	});
	try {
		const cipher = createCipheriv("aes-256-gcm", key, iv);
		cipher.setAAD(Buffer.from(context));
		const ciphertext = Buffer.concat([
			cipher.update(JSON.stringify(value), "utf8"),
			cipher.final(),
		]);
		return {
			version: 1,
			context,
			salt: salt.toString("hex"),
			iv: iv.toString("hex"),
			tag: cipher.getAuthTag().toString("hex"),
			ciphertext: ciphertext.toString("hex"),
		};
	} finally {
		key.fill(0);
	}
}
export function decryptSecret(
	value: unknown,
	password: string,
	context: string,
): unknown {
	try {
		const record = envelope.parse(value);
		if (record.context !== context) throw new Error("Wrong context");
		const key = scryptSync(password, Buffer.from(record.salt, "hex"), 32, {
			N: 65536,
			r: 8,
			p: 1,
			maxmem: 128 * 1024 * 1024,
		});
		try {
			const decipher = createDecipheriv(
				"aes-256-gcm",
				key,
				Buffer.from(record.iv, "hex"),
			);
			decipher.setAAD(Buffer.from(context));
			decipher.setAuthTag(Buffer.from(record.tag, "hex"));
			const plaintext = Buffer.concat([
				decipher.update(Buffer.from(record.ciphertext, "hex")),
				decipher.final(),
			]);
			try {
				return JSON.parse(plaintext.toString("utf8"));
			} finally {
				plaintext.fill(0);
			}
		} finally {
			key.fill(0);
		}
	} catch {
		throw new CliError(
			"unlock_failed",
			"无法解锁：密码错误、文件损坏或配置归属不匹配。请由用户本人检查，不要向 AI 提供密码或文件内容。",
			6,
		);
	}
}

async function privateDirectory(directory: string) {
	await mkdir(directory, { recursive: true, mode: 0o700 });
	const stat = await lstat(directory);
	if (
		stat.isSymbolicLink() ||
		!stat.isDirectory() ||
		(process.platform !== "win32" &&
			((stat.mode & 0o077) !== 0 || stat.uid !== process.getuid?.()))
	)
		throw new CliError(
			"insecure_permissions",
			"本地凭证目录须由当前用户拥有，且仅当前用户可访问（0700）；不接受符号链接。",
			2,
		);
}
export async function readPrivate(file: string): Promise<unknown> {
	const handle = await open(
		file,
		constants.O_RDONLY |
			(constants.O_NOFOLLOW ?? 0) |
			(constants.O_NONBLOCK ?? 0),
	);
	try {
		const stat = await handle.stat();
		if (
			!stat.isFile() ||
			stat.isSymbolicLink() ||
			stat.size > 131072 ||
			(process.platform !== "win32" &&
				((stat.mode & 0o077) !== 0 || stat.uid !== process.getuid?.()))
		)
			throw new CliError(
				"insecure_permissions",
				"凭证文件须由当前用户拥有，权限为 0600，不接受符号链接或超大文件。请用户本人检查文件，不要打印内容。",
				2,
			);
		return JSON.parse(await handle.readFile("utf8"));
	} finally {
		await handle.close();
	}
}
export async function writePrivate(file: string, value: unknown) {
	await privateDirectory(path.dirname(file));
	const temporary = `${file}.${randomBytes(8).toString("hex")}.tmp`;
	try {
		const handle = await open(temporary, "wx", 0o600);
		try {
			await handle.writeFile(JSON.stringify(value));
			await handle.sync();
		} finally {
			await handle.close();
		}
		await rename(temporary, file);
	} finally {
		await unlink(temporary).catch(() => {});
	}
}
export class CliStore {
	readonly directory: string;
	constructor(profile = "default", directory?: string) {
		if (directory !== undefined && !directory.trim())
			throw new CliError(
				"invalid_config_directory",
				"--config-dir 不能为空。",
				2,
			);
		if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,31}$/.test(profile))
			throw new CliError(
				"invalid_profile",
				"profile 只能包含字母、数字、下划线和短横线，最多 32 个字符。",
				2,
			);
		this.directory = path.resolve(
			directory ||
				process.env.TOKEN2API_CONFIG_DIR ||
				path.join(homedir(), ".config", "token2api"),
			profile,
		);
	}
	file(name: string) {
		return path.join(this.directory, name);
	}
	async session(platform?: string) {
		let session: LoginSession;
		try {
			session = sessionSchema.parse(
				await readPrivate(this.file("session.json")),
			);
		} catch (error) {
			if (error instanceof CliError) throw error;
			throw new CliError(
				"authentication_required",
				"尚未登录。请用户本人运行 auth login --interactive；不要把私钥交给 AI。",
				3,
			);
		}
		if (
			(platform && session.platform !== platform) ||
			session.expiresAt <= Date.now()
		)
			throw new CliError(
				"authentication_required",
				"会话已过期或不属于此平台。请用户本人重新登录。",
				3,
			);
		return session;
	}
	async platform(explicit?: string) {
		if (explicit) return explicit;
		try {
			return z
				.object({ platform: z.string().url() })
				.strict()
				.parse(await readPrivate(this.file("platform.json"))).platform;
		} catch {
			throw new CliError(
				"platform_required",
				"请使用 --platform 指定平台地址，或先由用户完成登录。",
				2,
			);
		}
	}
	async rememberPlatform(platform: string) {
		await writePrivate(this.file("platform.json"), { platform });
	}
	async logout() {
		await unlink(this.file("session.json")).catch(
			(error: NodeJS.ErrnoException) => {
				if (error.code !== "ENOENT") throw error;
			},
		);
	}
}
