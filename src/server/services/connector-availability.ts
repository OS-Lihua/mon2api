import { CONNECTOR_HEARTBEAT_MS } from "~/shared/connector";

type Supply = {
	transport?: string;
	connectorSeenAt?: Date | null;
	enabled: boolean;
	status?: string;
	model?: string;
	connectorCatalog?: unknown;
};
export function connectorOnline(listing: Supply, now = Date.now()) {
	if (
		listing.transport === "local" &&
		listing.status !== "DISCOVERING" &&
		Array.isArray(listing.connectorCatalog) &&
		!listing.connectorCatalog.includes(listing.model)
	)
		return false;
	return (
		listing.transport !== "local" ||
		(!!listing.connectorSeenAt &&
			listing.connectorSeenAt.getTime() > now - CONNECTOR_HEARTBEAT_MS)
	);
}
export function resourceAvailable(listing: Supply, now = Date.now()) {
	return (
		listing.status !== "DISCOVERING" &&
		listing.enabled &&
		connectorOnline(listing, now)
	);
}
