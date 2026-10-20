// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Local/testnet faucet token. Never represents real USD or USDC.
contract DemoUSDC is ERC20 {
    constructor() ERC20("Token2API Test USD Coin", "USDC") {}
    function decimals() public pure override returns (uint8) { return 6; }
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}
