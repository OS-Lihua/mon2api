// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable2Step.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

/// @notice One owner controls metering and receives newly allocated platform fees.
/// @dev Pausing never disables consumer timeout exits or withdrawals.
abstract contract EscrowControl is Ownable2Step, Pausable {
    constructor(address owner_) Ownable(owner_) {}

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    // Keep an owner for metering and recovery. Ownership can be transferred instead.
    function renounceOwnership() public override onlyOwner {
        revert("ownership required");
    }
}
