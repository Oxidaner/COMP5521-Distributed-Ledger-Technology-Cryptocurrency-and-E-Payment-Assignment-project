// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract ETHHTLC is ReentrancyGuard {
    enum Status { Active, Claimed, Refunded }

    struct Swap {
        address sender;
        address receiver;
        address token;
        uint256 amount;
        bytes32 hashlock;
        uint256 timelock;
        Status status;
    }

    mapping(bytes32 => Swap) public swaps;

    error InvalidSwapId();
    error InvalidReceiver();
    error InvalidAmount();
    error InvalidHashlock();
    error InvalidTimelock();
    error SwapAlreadyExists();
    error SwapNotFound();
    error Unauthorized();
    error NotActive();
    error ClaimExpired();
    error RefundNotDue();
    error InvalidPreimage();
    error TransferFailed();

    event SwapCreated(
        bytes32 indexed swapId,
        address indexed sender,
        address indexed receiver,
        address token,
        uint256 amount,
        bytes32 hashlock,
        uint256 timelock
    );
    event SwapClaimed(bytes32 indexed swapId, bytes32 preimage);
    event SwapRefunded(bytes32 indexed swapId);

    function createSwap(
        bytes32 swapId,
        address receiver,
        bytes32 hashlock,
        uint256 timelock
    ) external payable nonReentrant {
        if (swapId == bytes32(0)) revert InvalidSwapId();
        if (receiver == address(0) || receiver == msg.sender) revert InvalidReceiver();
        if (msg.value == 0) revert InvalidAmount();
        if (hashlock == bytes32(0)) revert InvalidHashlock();
        if (timelock <= block.timestamp) revert InvalidTimelock();
        if (swaps[swapId].sender != address(0)) revert SwapAlreadyExists();

        swaps[swapId] = Swap(msg.sender, receiver, address(0), msg.value, hashlock, timelock, Status.Active);
        emit SwapCreated(swapId, msg.sender, receiver, address(0), msg.value, hashlock, timelock);
    }

    function claim(bytes32 swapId, bytes32 preimage) external nonReentrant {
        Swap storage swap = swaps[swapId];
        if (swap.sender == address(0)) revert SwapNotFound();
        if (swap.receiver != msg.sender) revert Unauthorized();
        if (swap.status != Status.Active) revert NotActive();
        if (block.timestamp >= swap.timelock) revert ClaimExpired();
        if (keccak256(abi.encodePacked(preimage)) != swap.hashlock) revert InvalidPreimage();

        swap.status = Status.Claimed;
        (bool success,) = swap.receiver.call{value: swap.amount}("");
        if (!success) revert TransferFailed();
        emit SwapClaimed(swapId, preimage);
    }

    function refund(bytes32 swapId) external nonReentrant {
        Swap storage swap = swaps[swapId];
        if (swap.sender == address(0)) revert SwapNotFound();
        if (swap.sender != msg.sender) revert Unauthorized();
        if (swap.status != Status.Active) revert NotActive();
        if (block.timestamp < swap.timelock) revert RefundNotDue();

        swap.status = Status.Refunded;
        (bool success,) = swap.sender.call{value: swap.amount}("");
        if (!success) revert TransferFailed();
        emit SwapRefunded(swapId);
    }
}
