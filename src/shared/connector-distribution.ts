import { version } from "../../packages/connector/package.json";

export const connectorDownloadPath = `/downloads/token2api-connector-${version}.tgz`;

function shellArgument(value: string) {
	return /^[\w./:@-]+$/.test(value)
		? value
		: `'${value.replaceAll("'", "'\\''")}'`;
}

export function connectorStartCommand(
	platform: string,
	model?: string,
	connectCode?: string,
) {
	return [
		"npx",
		"--yes",
		`--package=${shellArgument(new URL(connectorDownloadPath, platform).href)}`,
		"token2api-connector start",
		`--platform ${shellArgument(platform)}`,
		`--upstream ${model ? "YOUR_UPSTREAM_URL" : "http://127.0.0.1:3425/v1"}`,
		...(model ? [`--model ${shellArgument(model)}`] : []),
		...(connectCode ? [`--connect-code ${shellArgument(connectCode)}`] : []),
	].join(" ");
}
