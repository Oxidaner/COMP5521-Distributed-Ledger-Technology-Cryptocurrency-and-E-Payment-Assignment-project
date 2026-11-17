// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IPrivateProbe {
    function claim(bytes32, uint256) external;
    function refund(bytes32) external;
    function createSwap(bytes32, address, uint256, uint256, uint256, uint256) external payable;
}

contract PrivateReceiverProbe {
    IPrivateProbe public escrow;
    bytes32 public swapId;
    uint256 public scalar;
    bool public rejectTransfer;
    bool public reentrySucceeded;
    function configure(address target, bytes32 id, uint256 secret, bool reject) external {
        escrow = IPrivateProbe(target); swapId = id; scalar = secret; rejectTransfer = reject;
    }
    function claim() external { escrow.claim(swapId, scalar); }
    function lock(address receiver, uint256 x, uint256 y, uint256 deadline) external payable {
        escrow.createSwap{value: msg.value}(swapId, receiver, msg.value, x, y, deadline);
    }
    function refund() external { escrow.refund(swapId); }
    receive() external payable {
        require(!rejectTransfer, "Rejected");
        (reentrySucceeded,) = address(escrow).call(abi.encodeCall(IPrivateProbe.claim, (swapId, scalar)));
    }
}
