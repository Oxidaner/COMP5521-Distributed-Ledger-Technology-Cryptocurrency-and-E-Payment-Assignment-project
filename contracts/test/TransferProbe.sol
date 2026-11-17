// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

interface IEscrowProbe {
    function createSwap(bytes32, address, bytes32, uint256) external payable;
    function claim(bytes32, bytes32) external;
    function refund(bytes32) external;
}

// Local safety tests only. These fixtures are never deployed by scripts/deploy.ts.
contract ETHReceiverProbe {
    IEscrowProbe public escrow;
    bytes32 public swapId;
    bytes32 public preimage;
    bool public rejectTransfer;
    bool public reentrySucceeded;

    function configure(address target, bytes32 id, bytes32 secret, bool reject) external {
        escrow = IEscrowProbe(target);
        swapId = id;
        preimage = secret;
        rejectTransfer = reject;
    }

    function claim() external { escrow.claim(swapId, preimage); }
    function lock(address receiver, bytes32 hashlock, uint256 timelock) external payable {
        escrow.createSwap{value: msg.value}(swapId, receiver, hashlock, timelock);
    }
    function refund() external { escrow.refund(swapId); }

    receive() external payable {
        require(!rejectTransfer, "Rejected");
        (reentrySucceeded,) = address(escrow).call(abi.encodeCall(IEscrowProbe.claim, (swapId, preimage)));
    }
}

contract FailingTokenProbe is ERC20 {
    bool public fail;
    constructor() ERC20("Probe", "TEST") { _mint(msg.sender, 1000); }
    function setFail(bool enabled) external { fail = enabled; }
    function transfer(address to, uint256 amount) public override returns (bool) {
        if (fail) return false;
        return super.transfer(to, amount);
    }
    function transferFrom(address from, address to, uint256 amount) public override returns (bool) {
        if (fail) return false;
        return super.transferFrom(from, to, amount);
    }
}
