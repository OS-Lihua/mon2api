// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "./EscrowControl.sol";

/// @notice Native EVM asset escrow. All amounts are wei; billing uses micro-units.
/// @dev The owner is the trusted usage oracle. Receipt hashes do not prove AI execution.
/// Chain selection is validated by the deployment tooling.
contract NativeUsageEscrow is EscrowControl, ReentrancyGuard {
    // Zero address identifies the native asset. All contract amounts are wei.
    address public constant token = address(0);
    uint256 public constant BILLING_UNIT = 1e12;
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

    constructor(address owner_, uint16 feeBps_) EscrowControl(owner_) {
        require(feeBps_ <= 2000, "fee too high");
        feeBps = feeBps_;
    }

    function openSession(bytes32 id, address provider, bytes32 termsHash, uint256 budget, uint64 expiresAt) external payable whenNotPaused nonReentrant {
        require(address(uint160(uint256(id >> 96))) == msg.sender, "session owner mismatch");
        require(sessions[id].consumer == address(0), "session exists");
        require(provider != address(0) && termsHash != bytes32(0) && budget > 0, "invalid terms");
        require(expiresAt > block.timestamp && expiresAt <= block.timestamp + 7 days, "invalid expiry");
        require(msg.value == budget && budget % BILLING_UNIT == 0, "invalid native deposit");
        sessions[id] = Session(msg.sender, provider, termsHash, budget, 0, 0, expiresAt, 0, false);
        emit SessionOpened(id, msg.sender, provider, budget, termsHash, expiresAt);
    }

    function settle(bytes32 id, uint256 cumulativeSpent, uint64 nonce, bytes32 receiptsHash) external onlyOwner whenNotPaused {
        Session storage s = sessions[id];
        require(s.consumer != address(0) && !s.closed, "inactive session");
        uint256 deadline = s.closeAfter == 0 ? uint256(s.expiresAt) + GRACE_PERIOD : s.closeAfter;
        require(block.timestamp < deadline, "settlement expired");
        require(nonce == s.nonce && receiptsHash != bytes32(0), "invalid receipt");
        require(cumulativeSpent > s.spent && cumulativeSpent <= s.budget, "invalid amount");
        require(cumulativeSpent % BILLING_UNIT == 0, "invalid billing precision");
        uint256 delta = cumulativeSpent - s.spent;
        // Cumulative fee rounding makes splitting a batch economically neutral.
        uint256 fee = Math.mulDiv(cumulativeSpent, feeBps, 10000) - Math.mulDiv(s.spent, feeBps, 10000);
        claimable[s.provider] += delta - fee;
        claimable[owner()] += fee;
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
        // The owner may finalize early while active. After the window anyone can
        // release the refund, always to the original consumer's claimable balance.
        require((msg.sender == owner() && !paused()) || block.timestamp >= deadline, "await settlement window");
        s.closed = true;
        uint256 refund = s.budget - s.spent;
        claimable[s.consumer] += refund;
        emit SessionClosed(id, refund);
    }

    function withdraw() external nonReentrant {
        _withdrawTo(payable(msg.sender));
    }

    /// @notice Withdraw the caller's balance to an address that can receive native assets.
    function withdrawTo(address payable recipient) external nonReentrant {
        _withdrawTo(recipient);
    }

    function _withdrawTo(address payable recipient) private {
        require(recipient != address(0), "zero recipient");
        uint256 amount = claimable[msg.sender];
        require(amount > 0, "nothing to withdraw");
        claimable[msg.sender] = 0;
        (bool sent,) = recipient.call{value: amount}("");
        require(sent, "Native transfer failed");
        emit Withdrawn(recipient, amount);
    }
}
