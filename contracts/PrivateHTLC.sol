// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice Optional point-lock escrow. Deploy with MST on Sepolia and address(0) on Arbitrum.
/// @dev The private relation and its Schnorr proof are verified off chain before counter-locking.
contract PrivateHTLC is ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant FIELD = 21888242871839275222246405745257275088696311157297823662689037894645226208583;
    uint256 public constant ORDER = 21888242871839275222246405745257275088548364400416034343698204186575808495617;
    enum Status { Active, Claimed, Refunded }
    struct Swap {
        address sender;
        address receiver;
        uint256 amount;
        uint256 pointX;
        uint256 pointY;
        uint256 timelock;
        Status status;
    }
    address public immutable token;
    mapping(bytes32 => Swap) public swaps;

    error InvalidSwap();
    error InvalidPoint();
    error InvalidScalar();
    error Unauthorized();
    error NotActive();
    error ClaimExpired();
    error RefundNotDue();
    error TransferFailed();
    event SwapCreated(bytes32 indexed swapId, address indexed sender, address indexed receiver,
        uint256 amount, uint256 pointX, uint256 pointY, uint256 timelock);
    event SwapClaimed(bytes32 indexed swapId, uint256 scalar);
    event SwapRefunded(bytes32 indexed swapId);

    constructor(address asset) {
        if (asset != address(0) && asset.code.length == 0) revert InvalidSwap();
        token = asset;
    }

    function createSwap(bytes32 swapId, address receiver, uint256 amount,
        uint256 pointX, uint256 pointY, uint256 timelock) external payable nonReentrant {
        if (swapId == bytes32(0) || swaps[swapId].sender != address(0) ||
            receiver == address(0) || receiver == msg.sender || amount == 0 ||
            timelock <= block.timestamp) revert InvalidSwap();
        if (pointX >= FIELD || pointY >= FIELD || (pointX == 0 && pointY == 0) ||
            mulmod(pointY, pointY, FIELD) != addmod(mulmod(mulmod(pointX, pointX, FIELD), pointX, FIELD), 3, FIELD))
            revert InvalidPoint();
        if (msg.value != (token == address(0) ? amount : 0)) revert InvalidSwap();
        swaps[swapId] = Swap(msg.sender, receiver, amount, pointX, pointY, timelock, Status.Active);
        if (token != address(0)) IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        emit SwapCreated(swapId, msg.sender, receiver, amount, pointX, pointY, timelock);
    }

    function claim(bytes32 swapId, uint256 scalar) external nonReentrant {
        Swap storage swap = swaps[swapId];
        if (msg.sender != swap.receiver) revert Unauthorized();
        if (swap.status != Status.Active) revert NotActive();
        if (block.timestamp >= swap.timelock) revert ClaimExpired();
        if (scalar == 0 || scalar >= ORDER) revert InvalidScalar();
        // EIP-196 ECMUL: compute scalar * (1,2), using Ethereum's BN254 G1 generator.
        (bool ok, bytes memory result) = address(7).staticcall(abi.encode(uint256(1), uint256(2), scalar));
        if (!ok || result.length != 64) revert InvalidPoint();
        (uint256 x, uint256 y) = abi.decode(result, (uint256, uint256));
        if (x != swap.pointX || y != swap.pointY) revert InvalidScalar();
        swap.status = Status.Claimed;
        _transfer(swap.receiver, swap.amount);
        emit SwapClaimed(swapId, scalar);
    }

    function refund(bytes32 swapId) external nonReentrant {
        Swap storage swap = swaps[swapId];
        if (msg.sender != swap.sender) revert Unauthorized();
        if (swap.status != Status.Active) revert NotActive();
        if (block.timestamp < swap.timelock) revert RefundNotDue();
        swap.status = Status.Refunded;
        _transfer(swap.sender, swap.amount);
        emit SwapRefunded(swapId);
    }

    function _transfer(address receiver, uint256 amount) private {
        if (token != address(0)) IERC20(token).safeTransfer(receiver, amount);
        else {
            (bool ok,) = receiver.call{value: amount}("");
            if (!ok) revert TransferFailed();
        }
    }
}
