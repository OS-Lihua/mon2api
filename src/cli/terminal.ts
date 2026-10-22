import { StringDecoder } from "node:string_decoder";
import { CliError } from "./protocol";

export function manualRequired(
	command: string,
	args: string[],
	field: string,
): never {
	throw new CliError(
		"manual_input_required",
		`需要用户本人在自己的终端手动输入${field}。不要在聊天中提供，也不要让 AI 读取、代填或打印。`,
		6,
		{
			field,
			manualCommand: [
				"token2api",
				...command.split(" "),
				...args,
				"--interactive",
			],
			resume: "用户完成后，AI 再运行 auth status 或 resource list 检查状态。",
		},
	);
}
export type SecretReader = (label: string) => Promise<string>;
export function terminalSecrets(
	interactive: boolean,
	command: string,
	publicArgs: string[],
): SecretReader {
	return async (label) => {
		if (!interactive || !process.stdin.isTTY)
			manualRequired(command, publicArgs, label);
		const input = process.stdin;
		const wasRaw = input.isRaw;
		const decoder = new StringDecoder("utf8");
		process.stderr.write(`请用户本人手动输入${label}（不回显；不要交给 AI）：`);
		input.setRawMode(true);
		input.resume();
		return new Promise<string>((resolve, reject) => {
			let value = "";
			const finish = () => {
				input.off("data", onData);
				input.off("end", ended);
				input.off("error", ended);
				input.setRawMode(wasRaw);
				input.pause();
				process.stderr.write("\n");
			};
			const ended = () => {
				finish();
				reject(new CliError("cancelled", "手动输入已取消。", 130));
			};
			const onData = (data: Buffer) => {
				for (const character of decoder.write(data)) {
					if (character === "\r" || character === "\n") {
						finish();
						resolve(value);
						return;
					}
					if (character === "\u0003" || character === "\u0004") {
						ended();
						return;
					}
					if (character === "\u007f" || character === "\b")
						value = Array.from(value).slice(0, -1).join("");
					else if (character >= " " && value.length < 4096) value += character;
				}
			};
			input.on("data", onData);
			input.once("end", ended);
			input.once("error", ended);
		});
	};
}
export async function newPassword(read: SecretReader) {
	const password = await read("凭证文件加密密码（至少 12 个字符）");
	if (password.length < 12 || password.length > 1024)
		throw new CliError("invalid_password", "加密密码须为 12–1024 个字符。", 2);
	if ((await read("再次确认加密密码")) !== password)
		throw new CliError("password_mismatch", "两次密码不一致；未保存凭证。", 2);
	return password;
}
