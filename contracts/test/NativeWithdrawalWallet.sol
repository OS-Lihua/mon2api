// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/utils/Address.sol";

/// @dev Test wallet: rejects native transfers until configured to attempt reentry.
contract NativeWithdrawalWallet {
    address private immutable owner = msg.sender;
    address private reentryTarget;
    bool public attempted;
    bool public reentered;
    uint256 public received;

    function execute(address target, bytes calldata data) external payable {
        require(msg.sender == owner, "owner only");
        Address.functionCallWithValue(target, data, msg.value);
    }

    function enableReentry(address target) external {
        require(msg.sender == owner, "owner only");
        reentryTarget = target;
    }

    receive() external payable {
        require(reentryTarget != address(0), "reject native");
        received += msg.value;
        if (!attempted) {
            attempted = true;
            (bool direct,) = reentryTarget.call(abi.encodeWithSignature("withdraw()"));
            (bool directed,) = reentryTarget.call(abi.encodeWithSignature("withdrawTo(address)", address(this)));
            reentered = direct || directed;
        }
    }
}
