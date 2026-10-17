import { parseAbi } from "viem";
export const tokenAbi = parseAbi([
	"function approve(address spender, uint256 amount) returns (bool)",
	"function balanceOf(address owner) view returns (uint256)",
	"function decimals() view returns (uint8)",
	"function mint(address to, uint256 amount)",
]);
export const escrowAbi = parseAbi([
	"function token() view returns (address)",
	"function meter() view returns (address)",
	"function treasury() view returns (address)",
	"function feeBps() view returns (uint16)",
	"function GRACE_PERIOD() view returns (uint64)",
	"function openSession(bytes32 id, address provider, bytes32 termsHash, uint256 budget, uint64 expiresAt)",
	"function sessions(bytes32 id) view returns (address consumer, address provider, bytes32 termsHash, uint256 budget, uint256 spent, uint64 nonce, uint64 expiresAt, uint64 closeAfter, bool closed)",
	"function settle(bytes32 id, uint256 cumulativeSpent, uint64 nonce, bytes32 receiptsHash)",
	"function requestClose(bytes32 id)",
	"function closeSession(bytes32 id)",
	"function claimable(address owner) view returns (uint256)",
	"function withdraw()",
	"event UsageSettled(bytes32 indexed id, uint64 indexed nonce, uint256 cumulativeSpent, bytes32 receiptsHash)",
	"event SessionOpened(bytes32 indexed id, address indexed consumer, address indexed provider, uint256 budget, bytes32 termsHash, uint64 expiresAt)",
	"event CloseRequested(bytes32 indexed id, uint64 closeAfter)",
	"event SessionClosed(bytes32 indexed id, uint256 refund)",
	"event Withdrawn(address indexed recipient, uint256 amount)",
]);

export const nativeEscrowAbi = parseAbi([
	"function openSession(bytes32 id, address provider, bytes32 termsHash, uint256 budget, uint64 expiresAt) payable",
]);
