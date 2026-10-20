"use client";

import { Copy, LoaderCircle, Plus } from "lucide-react";
import { type FormEvent, useRef, useState } from "react";
import { ConsoleSelect } from "~/app/_components/console-select";
import { connectorStartCommand } from "~/shared/connector-distribution";
import { parseMicroAmount } from "~/shared/money";
import type { SettlementAsset } from "~/shared/settlement-asset";
import { api } from "~/trpc/react";
import { Modal } from "./ui";

export type ConnectorDraft = { id: string; token: string; model: string };

/** Command-only view for a published local connector whose credential was reset. */
export function ConnectorLaunchModal({
	connection,
	busy,
	error,
	launchCommand,
	onClose,
	onCopy,
	onCopyStart,
}: {
	connection: ConnectorDraft;
	busy: boolean;
	error: string | null;
	launchCommand: string | null;
	onClose: () => void;
	onCopy: (value: string) => Promise<void>;
	onCopyStart: () => void;
}) {
	return (
		<Modal error={error} onClose={onClose} title="连接本机资源">
			<p>
				复制后直接在终端粘贴运行，无需另行输入平台连接凭证。启动命令 5
				分钟内有效，使用一次后失效。
			</p>
			<button
				className="button primary"
				disabled={busy}
				onClick={onCopyStart}
				type="button"
			>
				<Copy size={12} />
				复制并启动
			</button>
			<pre className="code-block mono">
				{launchCommand ??
					connectorStartCommand(window.location.origin, connection.model)}
			</pre>
			<p>
				本机上游 Key 按提示隐藏输入。其他网关请替换
				YOUR_UPSTREAM_URL。启动新连接会替换此资源的原连接。
			</p>
			<details>
				<summary>手动连接（高级）</summary>
				<div className="field">
					<label htmlFor="connector-token">平台连接器凭证</label>
					<input
						id="connector-token"
						readOnly
						type="password"
						value={launchCommand ? "请重置后使用手动连接" : connection.token}
					/>
				</div>
				<button
					className="button"
					disabled={!!launchCommand}
					onClick={() => void onCopy(connection.token)}
					type="button"
				>
					复制连接凭证
				</button>
			</details>
		</Modal>
	);
}

export function ConnectorSetupModal({
	asset,
	connection,
	copied,
	busy,
	error,
	onClose,
	onCopy,
	onCopyStart,
	launchCommand,
	onPublish,
	onReset,
}: {
	asset: SettlementAsset;
	connection: { id: string; token: string };
	copied: boolean;
	busy: boolean;
	error: string | null;
	onClose: () => void;
	onCopy: (value: string) => Promise<void>;
	onCopyStart: () => void;
	launchCommand: string | null;
	onReset: () => void;
	onPublish: (input: {
		model: string;
		inputRate: number;
		outputRate: number;
	}) => void;
}) {
	const setup = api.token2api.connectorSetup.useQuery(
		{ id: connection.id },
		{ refetchInterval: 2000 },
	);
	const [model, setModel] = useState("");
	const [priceError, setPriceError] = useState<string | null>(null);
	const models = setup.data?.models ?? [];
	const selected = models.includes(model) ? model : "";
	return (
		<Modal
			error={error || priceError || setup.error?.message}
			onClose={onClose}
			title="连接网关，自动读取模型"
		>
			<p>上游 Key 只在本机使用。连接器启动后，模型列表会自动出现在这里。</p>
			<p>
				在运行 Magpie 的电脑安装 Node.js 24
				或更高版本。复制后在终端粘贴运行，无需再次输入平台连接凭证。
			</p>
			<button
				className="button primary"
				disabled={busy}
				onClick={onCopyStart}
				type="button"
			>
				<Copy size={12} />
				{busy ? "正在准备…" : copied ? "已复制，请到终端粘贴" : "复制并启动"}
			</button>
			<pre className="code-block mono">
				{launchCommand ?? connectorStartCommand(window.location.origin)}
			</pre>
			<p>
				启动命令 5 分钟内有效，使用一次后失效。按提示隐藏输入 Magpie 调用
				Key；其他网关请替换上游地址。启动新连接会替换此资源的原连接。
			</p>
			<details>
				<summary>手动连接（高级）</summary>
				{connection.token && !launchCommand ? (
					<>
						<div className="field">
							<label htmlFor="connector-token">平台连接器凭证</label>
							<input
								id="connector-token"
								readOnly
								type="password"
								value={connection.token}
							/>
						</div>
						<button
							className="button"
							onClick={() => void onCopy(connection.token)}
							type="button"
						>
							复制连接凭证
						</button>
					</>
				) : (
					<p>使用已保存的凭证，或重置连接凭证后重新启动。</p>
				)}
			</details>
			<div className="notice" role="status">
				{setup.data?.online
					? `网关已连接，已读取 ${models.length} 个模型。`
					: "等待本机连接器上线并读取模型…"}
			</div>
			<form
				onSubmit={(event) => {
					event.preventDefault();
					setPriceError(null);
					const form = new FormData(event.currentTarget);
					try {
						onPublish({
							model: selected,
							inputRate: parseMicroAmount(String(form.get("inputRate"))),
							outputRate: parseMicroAmount(String(form.get("outputRate"))),
						});
					} catch (error) {
						setPriceError(
							error instanceof Error ? error.message : "请检查报价。",
						);
					}
				}}
			>
				<div className="field">
					<label htmlFor="discovered-model">选择模型</label>
					<ConsoleSelect
						disabled={!setup.data?.online || busy}
						id="discovered-model"
						onValueChange={setModel}
						options={models.map((value) => ({ value, label: value }))}
						placeholder="连接后自动读取"
						required
						value={selected}
					/>
					<small>
						模型列表来自网关声明，不表示模型身份已核验。上架后模型固定，按{" "}
						{asset} / 百万 Token 报价。
					</small>
				</div>
				<div className="field-row">
					{(["inputRate", "outputRate"] as const).map((name) => (
						<div className="field" key={name}>
							<label htmlFor={`discovered-${name}`}>
								{name === "inputRate" ? "输入" : "输出"}单价 / 百万 Token（
								{asset}）
							</label>
							<input
								defaultValue={name === "inputRate" ? "1" : "3"}
								id={`discovered-${name}`}
								max="1000"
								min="0.01"
								name={name}
								required
								step="0.000001"
								type="number"
							/>
						</div>
					))}
				</div>
				<div className="form-actions">
					<button
						className="button"
						disabled={busy}
						onClick={onReset}
						type="button"
					>
						重置连接凭证
					</button>
					<button
						className="button primary"
						disabled={busy || !setup.data?.online || !selected}
						type="submit"
					>
						确认模型并上架
					</button>
				</div>
			</form>
		</Modal>
	);
}

export function ListingModal({
	asset,
	error,
	onClose,
	onSubmit,
	busy,
}: {
	asset: SettlementAsset;
	onClose: () => void;
	onSubmit: (event: FormEvent<HTMLFormElement>) => void;
	error: string | null;
	busy: boolean;
}) {
	const [isLocal, setIsLocal] = useState(true);
	const [upstreamUrl, setUpstreamUrl] = useState("");
	const [upstreamKey, setUpstreamKey] = useState("");
	const [models, setModels] = useState<string[]>([]);
	const [selectedModel, setSelectedModel] = useState("");
	const [discoveryError, setDiscoveryError] = useState<string | null>(null);
	const discovery = api.token2api.discoverModels.useMutation();
	const generation = useRef(0);
	const resetModels = () => {
		generation.current++;
		setModels([]);
		setSelectedModel("");
		setDiscoveryError(null);
	};
	const readModels = async () => {
		const current = ++generation.current;
		setDiscoveryError(null);
		setModels([]);
		setSelectedModel("");
		try {
			const result = await discovery.mutateAsync({
				baseUrl: upstreamUrl,
				apiKey: upstreamKey,
			});
			if (current === generation.current) setModels(result.models);
		} catch (error) {
			if (current === generation.current)
				setDiscoveryError(
					error instanceof Error ? error.message : "读取模型失败。",
				);
		}
	};
	return (
		<Modal
			className="resource-modal"
			error={error || discoveryError}
			onClose={onClose}
			title="接入 AI 资源"
		>
			<form onSubmit={onSubmit}>
				<div className="field">
					<label className="connector-local-toggle">
						<input
							checked={isLocal}
							name="local"
							onChange={(event) => {
								setIsLocal(event.target.checked);
								resetModels();
							}}
							type="checkbox"
						/>{" "}
						Key 保留在本机，通过本机连接器提供服务
					</label>
					<small>
						{isLocal
							? "先连接 Magpie 或其他网关，系统自动读取模型列表。选择模型和报价后再上架，上游 Key 保留在本机。"
							: "填写网关地址和调用 Key 后读取模型列表，再选择模型和报价。平台将加密保存调用 Key。"}
					</small>
				</div>
				<div className="field-row">
					<div className="field">
						<label htmlFor="listing-name">资源名称</label>
						<input
							id="listing-name"
							maxLength={60}
							minLength={2}
							name="name"
							placeholder="我的 AI 资源"
							required
						/>
					</div>
					{!isLocal && (
						<div className="field">
							<label htmlFor="listing-model">选择模型</label>
							<ConsoleSelect
								disabled={models.length === 0}
								id="listing-model"
								name="model"
								onValueChange={setSelectedModel}
								options={models.map((model) => ({
									value: model,
									label: model,
								}))}
								placeholder="先读取网关模型列表"
								required
								value={selectedModel}
							/>
						</div>
					)}
				</div>
				<div className="field">
					<label htmlFor="listing-description">资源简介</label>
					<input
						id="listing-description"
						maxLength={300}
						minLength={2}
						name="description"
						placeholder="描述模型能力和适用场景"
						required
					/>
				</div>
				{!isLocal && (
					<div className="field-row resource-credentials">
						<div className="field">
							<label htmlFor="listing-url">API 服务地址</label>
							<input
								id="listing-url"
								name="baseUrl"
								onChange={(event) => {
									setUpstreamUrl(event.target.value);
									resetModels();
								}}
								placeholder="https://api.example.com/v1"
								required
								type="url"
								value={upstreamUrl}
							/>
							<small>
								支持自定义 API 基础路径。网关需支持文本 Chat Completions 和
								Token 用量，网关域名和端口需加入运营者允许列表。
							</small>
						</div>
						<div className="field">
							<label htmlFor="listing-secret">API Key</label>
							<input
								autoComplete="new-password"
								id="listing-secret"
								name="apiKey"
								onChange={(event) => {
									setUpstreamKey(event.target.value);
									resetModels();
								}}
								placeholder="填写上游 API Key"
								required
								type="password"
								value={upstreamKey}
							/>
							<small>凭证加密保存，仅用于服务端调用，不向使用者公开。</small>
						</div>
					</div>
				)}
				{!isLocal && (
					<>
						<div className="field">
							<button
								className="button"
								disabled={
									busy || discovery.isPending || !upstreamUrl || !upstreamKey
								}
								onClick={() => void readModels()}
								type="button"
							>
								{discovery.isPending ? "正在读取…" : "读取模型列表"}
							</button>
							<small>
								{models.length
									? `已读取 ${models.length} 个模型，请从列表中选择。`
									: "网关需在 API 基础路径下提供 /models。这里只读取声明，不验证模型身份。"}
							</small>
						</div>
						<div className="field-row">
							<div className="field">
								<label htmlFor="listing-input">
									输入单价 / 百万 Token（{asset}）
								</label>
								<input
									defaultValue="1"
									id="listing-input"
									max="1000"
									min="0.01"
									name="inputRate"
									required
									step="0.000001"
									type="number"
								/>
							</div>
							<div className="field">
								<label htmlFor="listing-output">
									输出单价 / 百万 Token（{asset}）
								</label>
								<input
									defaultValue="3"
									id="listing-output"
									max="1000"
									min="0.01"
									name="outputRate"
									required
									step="0.000001"
									type="number"
								/>
							</div>
						</div>
						<div className="field">
							<label htmlFor="listing-concurrency">最大并发请求</label>
							<input
								defaultValue={isLocal ? "1" : "2"}
								id="listing-concurrency"
								key={`concurrency-${isLocal}`}
								max={isLocal ? "1" : "20"}
								min="1"
								name="concurrency"
								readOnly={isLocal}
								required
								type="number"
							/>
						</div>
					</>
				)}
				<div className="form-actions">
					<button
						className="button"
						disabled={busy}
						onClick={onClose}
						type="button"
					>
						取消
					</button>
					<button
						className="button primary"
						disabled={busy || (!isLocal && !models.includes(selectedModel))}
						type="submit"
					>
						{busy ? (
							<LoaderCircle className="spin" size={12} />
						) : (
							<Plus size={12} />
						)}
						{isLocal ? "连接网关，自动读取模型" : "接入并上架"}
					</button>
				</div>
			</form>
		</Modal>
	);
}
