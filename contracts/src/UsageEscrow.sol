// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "./EscrowControl.sol";

/// @notice Budget-bounded settlement. The owner is a trusted usage oracle.
/// @dev Only supports non-rebasing ERC20 tokens without transfer fees. Receipts
/// hashes anchor off-chain records; they do not prove that AI work occurred.
contract UsageEscrow is EscrowControl, ReentrancyGuard {
    using SafeERC20 for IERC20;
    IERC20 public immutable token;
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
    mapping(address => uint256) public prepaidBalance;
    mapping(bytes32 => bool) public prepaidSession;
    mapping(bytes32 => uint256) public providerSpent;

    event PrepaidDeposited(address indexed consumer, uint256 amount);
    event PrepaidWithdrawn(address indexed consumer, uint256 amount);
    event PrepaidUsageSettled(bytes32 indexed id, uint64 indexed nonce, uint256 providerCumulative, bytes32 receiptsHash);


    event SessionOpened(bytes32 indexed id, address indexed consumer, address indexed provider, uint256 budget, bytes32 termsHash, uint64 expiresAt);
    event UsageSettled(bytes32 indexed id, uint64 indexed nonce, uint256 cumulativeSpent, bytes32 receiptsHash);
    event CloseRequested(bytes32 indexed id, uint64 closeAfter);
    event SessionClosed(bytes32 indexed id, uint256 refund);
    event Withdrawn(address indexed recipient, uint256 amount);

    constructor(IERC20 token_, address owner_, uint16 feeBps_) EscrowControl(owner_) {
        require(address(token_) != address(0), "zero address");
        require(feeBps_ <= 2000, "fee too high");
        token = token_; feeBps = feeBps_;
    }

    // Prepaid funds are a separate pool. Existing wallet-funded sessions are unchanged.
    function prepaidVersion() external pure returns (uint256) { return 1; }

    function depositPrepaid(uint256 amount) external whenNotPaused nonReentrant {
        require(amount > 0 && amount % _prepaidScale() == 0, "invalid amount");
        uint256 beforeBalance = token.balanceOf(address(this));
        token.safeTransferFrom(msg.sender, address(this), amount);
        require(token.balanceOf(address(this)) - beforeBalance == amount, "unsupported token");
        prepaidBalance[msg.sender] += amount;
        emit PrepaidDeposited(msg.sender, amount);
    }

    function withdrawPrepaid(uint256 amount) external nonReentrant {
        require(amount % _prepaidScale() == 0, "invalid billing precision");
        require(amount > 0 && amount <= prepaidBalance[msg.sender], "insufficient prepaid balance");
        prepaidBalance[msg.sender] -= amount;
        token.safeTransfer(msg.sender, amount);
        emit PrepaidWithdrawn(msg.sender, amount);
    }

    function reservePrepaidSession(bytes32 id, address consumer, address provider, bytes32 termsHash, uint256 budget, uint64 expiresAt) external onlyOwner whenNotPaused {
        require(consumer != address(0) && address(uint160(uint256(id >> 96))) == consumer, "session owner mismatch");
        require(sessions[id].consumer == address(0), "session exists");
        require(provider != address(0) && termsHash != bytes32(0) && budget > 0, "invalid terms");
        require(expiresAt > block.timestamp && expiresAt <= block.timestamp + 7 days, "invalid expiry");

        require(budget % _prepaidScale() == 0, "invalid billing precision");
        require(prepaidBalance[consumer] >= budget, "insufficient prepaid balance");
        prepaidBalance[consumer] -= budget;
        prepaidSession[id] = true;
        sessions[id] = Session(consumer, provider, termsHash, budget, 0, 0, expiresAt, 0, false);
        emit SessionOpened(id, consumer, provider, budget, termsHash, expiresAt);
    }

    function settlePrepaid(bytes32 id, uint256 cumulativeSpent, uint256 providerCumulative, uint64 nonce, bytes32 receiptsHash) external onlyOwner whenNotPaused {
        Session storage s = sessions[id];
        require(prepaidSession[id] && !s.closed, "inactive prepaid session");
        uint256 deadline = s.closeAfter == 0 ? uint256(s.expiresAt) + GRACE_PERIOD : s.closeAfter;
        require(block.timestamp < deadline, "settlement expired");
        require(nonce == s.nonce && receiptsHash != bytes32(0), "invalid receipt");
        require(cumulativeSpent > s.spent && cumulativeSpent <= s.budget, "invalid amount");

        uint256 scale = _prepaidScale();
        require(cumulativeSpent % scale == 0 && providerCumulative % scale == 0, "invalid billing precision");
        uint256 previousProvider = providerSpent[id];
        require(providerCumulative >= previousProvider && providerCumulative <= cumulativeSpent, "invalid provider amount");
        uint256 delta = cumulativeSpent - s.spent;
        uint256 providerDelta = providerCumulative - previousProvider;
        require(providerDelta <= delta, "provider amount exceeds charge");
        uint256 fee = Math.mulDiv(providerCumulative, feeBps, 10000) - Math.mulDiv(previousProvider, feeBps, 10000);
        claimable[s.provider] += providerDelta - fee;
        claimable[owner()] += delta - providerDelta + fee;
        providerSpent[id] = providerCumulative;
        s.spent = cumulativeSpent;
        s.nonce++;
        emit UsageSettled(id, nonce, cumulativeSpent, receiptsHash);
        emit PrepaidUsageSettled(id, nonce, providerCumulative, receiptsHash);
    }

    function _prepaidScale() private view returns (uint256) {
        uint8 precision = IERC20Metadata(address(token)).decimals();
        require(precision >= 6 && precision <= 18, "unsupported token precision");
        return 10 ** (precision - 6);
    }

    function openSession(bytes32 id, address provider, bytes32 termsHash, uint256 budget, uint64 expiresAt) external whenNotPaused nonReentrant {
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

    function settle(bytes32 id, uint256 cumulativeSpent, uint64 nonce, bytes32 receiptsHash) external onlyOwner whenNotPaused {
        Session storage s = sessions[id];
        require(!prepaidSession[id], "use prepaid settlement");
        require(s.consumer != address(0) && !s.closed, "inactive session");
        uint256 deadline = s.closeAfter == 0 ? uint256(s.expiresAt) + GRACE_PERIOD : s.closeAfter;
        require(block.timestamp < deadline, "settlement expired");
        require(nonce == s.nonce && receiptsHash != bytes32(0), "invalid receipt");
        require(cumulativeSpent > s.spent && cumulativeSpent <= s.budget, "invalid amount");
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
        if (prepaidSession[id]) prepaidBalance[s.consumer] += refund;
        else claimable[s.consumer] += refund;
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
