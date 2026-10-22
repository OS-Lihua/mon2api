import "server-only";
import {
	BODY_READ_TIMEOUT_MS,
	MAX_RAW_BODY_BYTES,
} from "~/server/services/token2api.contract";

export class BodyReadError extends Error {
	constructor(
		message: string,
		readonly status: 408 | 413,
	) {
		super(message);
	}
}

/** Count streamed bytes, including when Content-Length is absent or incorrect. */
export async function readRequestText(request: Request): Promise<string> {
	if (!request.body) return "";
	const reader = request.body.getReader();
	let timeout: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			(async () => {
				const decoder = new TextDecoder();
				let bytes = 0;
				let text = "";
				for (;;) {
					const { done, value } = await reader.read();
					if (done) return text + decoder.decode();
					bytes += value.byteLength;
					if (bytes > MAX_RAW_BODY_BYTES)
						throw new BodyReadError("Request body exceeds 160 KiB", 413);
					text += decoder.decode(value, { stream: true });
				}
			})(),
			new Promise<never>((_resolve, reject) => {
				timeout = setTimeout(
					() => reject(new BodyReadError("Request body read timed out", 408)),
					BODY_READ_TIMEOUT_MS,
				);
			}),
		]);
	} catch (error) {
		// Do not let a stalled source's cancellation delay the error response.
		void reader.cancel().catch(() => undefined);
		throw error;
	} finally {
		clearTimeout(timeout);
		reader.releaseLock();
	}
}
