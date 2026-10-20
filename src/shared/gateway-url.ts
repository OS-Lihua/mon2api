/** Keep an explicit API prefix; a bare origin uses the conventional /v1 base. */
export function gatewayApiBase(raw: string): string {
	const url = new URL(raw);
	const path = url.pathname.replace(/\/+$/, "");
	if (
		!["http:", "https:"].includes(url.protocol) ||
		url.username ||
		url.password ||
		url.search ||
		url.hash ||
		/\/(?:models|chat\/completions)$/.test(path)
	)
		throw new Error(
			"请填写 API 基础地址，不要包含凭证、查询参数或具体接口路径。",
		);
	url.pathname = path || "/v1";
	url.search = "";
	url.hash = "";
	return url.toString().replace(/\/$/, "");
}
