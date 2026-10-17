// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";

/// @notice Budget-bounded settlement. The meter is a trusted usage oracle.
/// @dev Only supports non-rebasing ERC20 tokens without transfer fees. Receipts
/// hashes anchor off-chain records; they do not prove that AI work occurred.
contract UsageEscrow is ReentrancyGuard {
    using SafeERC20 for IERC20;
    IERC20 public immutable token;
    address public immutable meter;
    address public immutable treasury;
    uint16 public immutable feeBps;
    uint64 public constant GRACE_PERIOD = 120;

    struct Session {
        address consumer;
        address provider;
        bytes32 termsHash;
        uint256 budget;
        uint256 spent;
        uint64 nonce;
        uint64 expiresAt;
        uint64 closeAfter;
        bool closed;
    }
    mapping(bytes32 => Session) public sessions;
    mapping(address => uint256) public claimable;

    event SessionOpened(bytes32 indexed id, address indexed consumer, address indexed provider, uint256 budget, bytes32 termsHash, uint64 expiresAt);
    event UsageSettled(bytes32 indexed id, uint64 indexed nonce, uint256 cumulativeSpent, bytes32 receiptsHash);
    event CloseRequested(bytes32 indexed id, uint64 closeAfter);
    event SessionClosed(bytes32 indexed id, uint256 refund);
    event Withdrawn(address indexed recipient, uint256 amount);

    constructor(IERC20 token_, address meter_, address treasury_, uint16 feeBps_) {
        require(address(token_) != address(0) && meter_ != address(0) && treasury_ != address(0), "zero address");
        require(feeBps_ <= 2000, "fee too high");
        token = token_; meter = meter_; treasury = treasury_; feeBps = feeBps_;
    }

    function openSession(bytes32 id, address provider, bytes32 termsHash, uint256 budget, uint64 expiresAt) external nonReentrant {
        require(address(uint160(uint256(id >> 96))) == msg.sender, "session owner mismatch");
        require(sessions[id].consumer == address(0), "session exists");
        require(provider != address(0) && termsHash != bytes32(0) && budget > 0, "invalid terms");
        require(expiresAt > block.timestamp && expiresAt <= block.timestamp + 7 days, "invalid expiry");
        sessions[id] = Session(msg.sender, provider, termsHash, budget, 0, 0, expiresAt, 0, false);
        uint256 previousBalance = token.balanceOf(address(this));
        token.safeTransferFrom(msg.sender, address(this), budget);
        require(token.balanceOf(address(this)) - previousBalance == budget, "unsupported token");
        emit SessionOpened(id, msg.sender, provider, budget, termsHash, expiresAt);
    }

    function settle(bytes32 id, uint256 cumulativeSpent, uint64 nonce, bytes32 receiptsHash) external {
        require(msg.sender == meter, "meter only");
        Session storage s = sessions[id];
        require(s.consumer != address(0) && !s.closed, "inactive session");
        uint256 deadline = s.closeAfter == 0 ? uint256(s.expiresAt) + GRACE_PERIOD : s.closeAfter;
        require(block.timestamp < deadline, "settlement expired");
        require(nonce == s.nonce && receiptsHash != bytes32(0), "invalid receipt");
        require(cumulativeSpent > s.spent && cumulativeSpent <= s.budget, "invalid amount");
        uint256 delta = cumulativeSpent - s.spent;
        // Cumulative fee rounding makes splitting a batch economically neutral.
        uint256 fee = Math.mulDiv(cumulativeSpent, feeBps, 10000) - Math.mulDiv(s.spent, feeBps, 10000);
        claimable[s.provider] += delta - fee;
        claimable[treasury] += fee;
        s.spent = cumulativeSpent;
        s.nonce++;
        emit UsageSettled(id, nonce, cumulativeSpent, receiptsHash);
    }

    function requestClose(bytes32 id) external {
        Session storage s = sessions[id];
        require(msg.sender == s.consumer && !s.closed && s.closeAfter == 0, "cannot close");
        uint256 expiryDeadline = uint256(s.expiresAt) + GRACE_PERIOD;
        uint256 requestedDeadline = block.timestamp + GRACE_PERIOD;
        s.closeAfter = uint64(requestedDeadline < expiryDeadline ? requestedDeadline : expiryDeadline);
        emit CloseRequested(id, s.closeAfter);
    }

    function closeSession(bytes32 id) external {
        Session storage s = sessions[id];
        require(s.consumer != address(0) && !s.closed, "inactive session");
        uint256 deadline = s.closeAfter == 0 ? uint256(s.expiresAt) + GRACE_PERIOD : s.closeAfter;
        // The trusted meter may finalize early. After the window anyone can
        // release the refund, always to the original consumer's claimable balance.
        require(msg.sender == meter || block.timestamp >= deadline, "await settlement window");
        s.closed = true;
        uint256 refund = s.budget - s.spent;
        claimable[s.consumer] += refund;
        emit SessionClosed(id, refund);
    }

    function withdraw() external nonReentrant {
        uint256 amount = claimable[msg.sender];
        require(amount > 0, "nothing to withdraw");
        claimable[msg.sender] = 0;
        token.safeTransfer(msg.sender, amount);
        emit Withdrawn(msg.sender, amount);
    }
}
