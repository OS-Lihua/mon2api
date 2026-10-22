import { parseAbi } from "viem";

export const prepaidAbi = parseAbi([
	"function prepaidVersion() pure returns (uint256)",
	"function prepaidBalance(address) view returns (uint256)",
	"function prepaidSession(bytes32) view returns (bool)",
	"function providerSpent(bytes32) view returns (uint256)",
	"function depositPrepaid(uint256 amount) payable",
	"function withdrawPrepaid(uint256 amount)",
	"function reservePrepaidSession(bytes32 id, address consumer, address provider, bytes32 termsHash, uint256 budget, uint64 expiresAt)",
	"function settlePrepaid(bytes32 id, uint256 cumulativeSpent, uint256 providerCumulative, uint64 nonce, bytes32 receiptsHash)",
	"event PrepaidUsageSettled(bytes32 indexed id, uint64 indexed nonce, uint256 providerCumulative, bytes32 receiptsHash)",
]);
