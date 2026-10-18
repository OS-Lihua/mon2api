// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
/// @notice Local regression fixture only. Never represents an issued stablecoin.
contract SettlementTestToken is ERC20 {
    uint8 private immutable precision;
    constructor(uint8 decimals_) ERC20("Settlement test token", "TEST") { precision = decimals_; }
    function decimals() public view override returns (uint8) { return precision; }
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}
