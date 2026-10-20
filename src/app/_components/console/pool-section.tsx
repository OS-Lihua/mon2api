"use client";

import { ShieldCheck } from "lucide-react";
import type { ListingView, Snapshot } from "~/shared/token2api";
import { sameAddress } from "./format";
import { ResourceTable } from "./tables";
import { Empty, Panel } from "./ui";

export function PoolSection({
	data,
	busy,
	onConnect,
	onToggle,
}: {
	data: Snapshot;
	busy: boolean;
	onConnect: (listing: ListingView) => void;
	onToggle: (listing: ListingView) => void;
}) {
	const owned = data.listings.filter((item) =>
		sameAddress(item.owner, data.viewer?.address),
	);
	return (
		<>
			<div className="notice info">
				<ShieldCheck size={14} />
				<span>仅接入有权提供的服务；限流不保证避免上游停用。</span>
			</div>
			<Panel title="我提供的资源">
				<ResourceTable
					busy={busy}
					listings={owned}
					onConnect={onConnect}
					onToggle={onToggle}
				/>
				{!owned.length && (
					<Empty
						description="使用页首的「接入资源」，添加本机连接器或你自行部署的上游网关。"
						title="开始提供第一份资源"
					/>
				)}
			</Panel>
		</>
	);
}
