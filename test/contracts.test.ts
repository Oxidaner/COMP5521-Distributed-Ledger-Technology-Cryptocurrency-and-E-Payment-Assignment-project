import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";
import { keccak256, parseEther, ZeroAddress, ZeroHash } from "ethers";
import { network } from "hardhat";

const { ethers } = await network.create("mstLocal");

function id(label: string): string {
  return keccak256(Buffer.from(`${label}-${randomBytes(8).toString("hex")}`));
}

async function future(seconds: number): Promise<void> {
  await ethers.provider.send("evm_increaseTime", [seconds]);
  await ethers.provider.send("evm_mine", []);
}

async function expectRevert(action: Promise<unknown>, fragment: string): Promise<void> {
  await assert.rejects(action, (error: unknown) => String(error).includes(fragment));
}

test("ERC20HTLC locks and claims exactly once", async () => {
  const [alice, bob, stranger] = await ethers.getSigners();
  const mst = await ethers.deployContract("MST", [parseEther("1000")], alice) as any;
  const htlc = await ethers.deployContract("ERC20HTLC", [mst.target], alice) as any;
  const preimage = `0x${"11".repeat(32)}`;
  const hashlock = keccak256(preimage);
  const swapId = id("erc20-success");
  const amount = parseEther("25");
  const block = await ethers.provider.getBlock("latest");
  const timelock = BigInt(block!.timestamp) + 3600n;

  await mst.connect(alice).approve(htlc.target, amount);
  await htlc.connect(alice).createSwap(swapId, bob.address, amount, hashlock, timelock);

  const record = await htlc.swaps(swapId);
  assert.equal(record.sender, alice.address);
  assert.equal(record.receiver, bob.address);
  assert.equal(record.amount, amount);
  assert.equal(record.status, 0n);
  assert.equal(await mst.balanceOf(htlc.target), amount);

  await expectRevert(htlc.connect(stranger).claim(swapId, preimage), "Unauthorized");
  await expectRevert(htlc.connect(bob).claim(swapId, `0x${"22".repeat(32)}`), "InvalidPreimage");
  await htlc.connect(bob).claim(swapId, preimage);

  assert.equal(await mst.balanceOf(bob.address), amount);
  assert.equal((await htlc.swaps(swapId)).status, 1n);
  await expectRevert(htlc.connect(bob).claim(swapId, preimage), "NotActive");
  await expectRevert(htlc.connect(alice).refund(swapId), "NotActive");
});

test("ERC20HTLC rejects a missing MST contract at deployment", async () => {
  const [alice] = await ethers.getSigners();
  await expectRevert(ethers.deployContract("ERC20HTLC", [ZeroAddress]), "InvalidToken");
  await expectRevert(ethers.deployContract("ERC20HTLC", [alice.address]), "InvalidToken");
});

test("ERC20HTLC only refunds the sender after expiry", async () => {
  const [alice, bob, stranger] = await ethers.getSigners();
  const mst = await ethers.deployContract("MST", [parseEther("100")], alice) as any;
  const htlc = await ethers.deployContract("ERC20HTLC", [mst.target], alice) as any;
  const amount = parseEther("4");
  const swapId = id("erc20-refund");
  const block = await ethers.provider.getBlock("latest");
  const timelock = BigInt(block!.timestamp) + 20n;

  await mst.approve(htlc.target, amount);
  await htlc.createSwap(swapId, bob.address, amount, keccak256(`0x${"33".repeat(32)}`), timelock);
  await expectRevert(htlc.connect(alice).refund(swapId), "RefundNotDue");
  await expectRevert(htlc.connect(stranger).refund(swapId), "Unauthorized");
  await future(21);
  await htlc.connect(alice).refund(swapId);

  assert.equal(await mst.balanceOf(alice.address), parseEther("100"));
  assert.equal((await htlc.swaps(swapId)).status, 2n);
  await expectRevert(htlc.connect(alice).refund(swapId), "NotActive");
  await expectRevert(htlc.connect(bob).claim(swapId, `0x${"33".repeat(32)}`), "NotActive");
});

test("ETHHTLC transfers ETH to the designated receiver on claim", async () => {
  const [alice, bob] = await ethers.getSigners();
  const htlc = await ethers.deployContract("ETHHTLC", [], alice) as any;
  const preimage = `0x${"44".repeat(32)}`;
  const swapId = id("eth-success");
  const amount = parseEther("1");
  const block = await ethers.provider.getBlock("latest");
  const timelock = BigInt(block!.timestamp) + 30n;
  const before = await ethers.provider.getBalance(bob.address);

  await htlc.createSwap(swapId, bob.address, keccak256(preimage), timelock, { value: amount });
  await htlc.connect(bob).claim(swapId, preimage);
  const after = await ethers.provider.getBalance(bob.address);
  assert(after > before);
  assert.equal((await htlc.swaps(swapId)).status, 1n);
});

test("ETHHTLC refunds after expiry and validates lock parameters", async () => {
  const [alice, bob] = await ethers.getSigners();
  const htlc = await ethers.deployContract("ETHHTLC", [], alice) as any;
  const swapId = id("eth-refund");
  const block = await ethers.provider.getBlock("latest");
  const timelock = BigInt(block!.timestamp) + 15n;

  await expectRevert(
    htlc.createSwap(`0x${"00".repeat(32)}`, bob.address, keccak256(`0x${"55".repeat(32)}`), timelock, { value: 1n }),
    "InvalidSwapId",
  );
  await expectRevert(
    htlc.createSwap(swapId, bob.address, keccak256(`0x${"55".repeat(32)}`), timelock, { value: 0n }),
    "InvalidAmount",
  );
  await htlc.createSwap(swapId, bob.address, keccak256(`0x${"55".repeat(32)}`), timelock, { value: 1n });
  await future(16);
  await htlc.refund(swapId);
  assert.equal((await htlc.swaps(swapId)).status, 2n);
});

test("local network configurations keep the required chain IDs", async () => {
  assert.equal((await ethers.provider.getNetwork()).chainId, 11155111n);
  const other = await network.create("ethLocal");
  assert.equal((await other.ethers.provider.getNetwork()).chainId, 421614n);
});

for (const kind of ["ERC20", "ETH"] as const) {
  test(`${kind} validates inputs, missing swaps and exact expiry boundaries`, async () => {
    const connection = await network.create("mstLocal");
    try {
      const api = connection.ethers;
      const [sender, receiver, other] = await api.getSigners();
      const token = kind === "ERC20" ? await api.deployContract("MST", [1000n]) : null;
      const escrow = await api.deployContract(kind === "ERC20" ? "ERC20HTLC" : "ETHHTLC", token ? [token.target] : []);
      if (token) await token.approve(escrow.target, 1000n);
      const swapId = id(kind);
      const preimage = `0x${"66".repeat(32)}`;
      const hashlock = keccak256(preimage);
      const latest = await api.provider.getBlock("latest");
      const expiry = latest!.timestamp + 200;
      const create = (sid = swapId, recipient = receiver.address, amount = 5n, hash = hashlock, time = expiry) => token
        ? escrow.getFunction("createSwap")(sid, recipient, amount, hash, time)
        : escrow.getFunction("createSwap")(sid, recipient, hash, time, { value: amount });
      await expectRevert(create(ZeroHash), "InvalidSwapId");
      await expectRevert(create(swapId, ZeroAddress), "InvalidReceiver");
      await expectRevert(create(swapId, sender.address), "InvalidReceiver");
      await expectRevert(create(swapId, receiver.address, 0n), "InvalidAmount");
      await expectRevert(create(swapId, receiver.address, 5n, ZeroHash), "InvalidHashlock");
      await expectRevert(create(swapId, receiver.address, 5n, hashlock, latest!.timestamp), "InvalidTimelock");
      await expectRevert(escrow.getFunction("claim")(id("missing"), preimage), "SwapNotFound");
      const receipt = await (await create()).wait();
      const event = receipt.logs.map((log: { topics: string[]; data: string }) => { try { return escrow.interface.parseLog(log); } catch { return null; } }).find((event: { name: string } | null) => event?.name === "SwapCreated");
      assert.equal(event.args.swapId, swapId);
      assert.equal(event.args.amount, 5n);
      await expectRevert(create(), "SwapAlreadyExists");
      await expectRevert(escrow.connect(other).getFunction("claim")(swapId, preimage), "Unauthorized");
      await expectRevert(escrow.connect(receiver).getFunction("claim")(swapId, ZeroHash), "InvalidPreimage");
      await expectRevert(escrow.getFunction("refund")(swapId), "RefundNotDue");
      await api.provider.send("evm_setNextBlockTimestamp", [expiry]);
      await api.provider.send("evm_mine", []);
      await expectRevert(escrow.connect(receiver).getFunction("claim")(swapId, preimage), "ClaimExpired");
      await expectRevert(escrow.connect(other).getFunction("refund")(swapId), "Unauthorized");
      await escrow.getFunction("refund")(swapId);
      await expectRevert(escrow.getFunction("refund")(swapId), "NotActive");
      assert.equal((await escrow.getFunction("swaps")(swapId)).status, 2n);
    } finally { await connection.close(); }
  });
}

test("ETH transfer failure rolls back claim/refund and receiver reentry cannot drain escrow", async () => {
  const connection = await network.create("ethLocal");
  try {
    const api = connection.ethers;
    const [alice, bob] = await api.getSigners();
    const escrow = await api.deployContract("ETHHTLC");
    const probe = await api.deployContract("ETHReceiverProbe");
    const preimage = `0x${"77".repeat(32)}`;
    const swapId = id("reentry");
    const expiry = (await api.provider.getBlock("latest"))!.timestamp + 300;
    await probe.getFunction("configure")(escrow.target, swapId, preimage, true);
    await escrow.getFunction("createSwap")(swapId, probe.target, keccak256(preimage), expiry, { value: 7n });
    await expectRevert(probe.getFunction("claim")(), "TransferFailed");
    assert.equal((await escrow.getFunction("swaps")(swapId)).status, 0n);
    assert.equal(await api.provider.getBalance(escrow.target), 7n);
    await probe.getFunction("configure")(escrow.target, swapId, preimage, false);
    const receipt = await (await probe.getFunction("claim")()).wait();
    assert.equal(await probe.getFunction("reentrySucceeded")(), false);
    assert.equal(await api.provider.getBalance(probe.target), 7n);
    assert.equal((await escrow.getFunction("swaps")(swapId)).status, 1n);
    const revealed = receipt.logs.map((log: { topics: string[]; data: string }) => { try { return escrow.interface.parseLog(log); } catch { return null; } }).find((event: { name: string } | null) => event?.name === "SwapClaimed");
    assert.equal(revealed.args.preimage, preimage);

    const refundId = id("failed-refund");
    await probe.getFunction("configure")(escrow.target, refundId, preimage, true);
    await probe.getFunction("lock")(bob.address, keccak256(preimage), expiry, { value: 9n });
    await api.provider.send("evm_setNextBlockTimestamp", [expiry]);
    await api.provider.send("evm_mine", []);
    await expectRevert(probe.getFunction("refund")(), "TransferFailed");
    assert.equal((await escrow.getFunction("swaps")(refundId)).status, 0n);
    await probe.getFunction("configure")(escrow.target, refundId, preimage, false);
    await probe.getFunction("refund")();
    assert.equal((await escrow.getFunction("swaps")(refundId)).status, 2n);
    assert.equal(await api.provider.getBalance(escrow.target), 0n);
    assert.equal(await api.provider.getBalance(probe.target), 16n);
    assert.notEqual(alice.address, bob.address);
  } finally { await connection.close(); }
});

test("SafeERC20 failure rolls back lock, claim and refund without losing the active record", async () => {
  const connection = await network.create("mstLocal");
  try {
    const api = connection.ethers;
    const [alice, bob] = await api.getSigners();
    const token = await api.deployContract("FailingTokenProbe");
    const escrow = await api.deployContract("ERC20HTLC", [token.target]);
    const swapId = id("failing-token");
    const preimage = `0x${"88".repeat(32)}`;
    const expiry = (await api.provider.getBlock("latest"))!.timestamp + 300;
    const create = () => escrow.getFunction("createSwap")(swapId, bob.address, 10n, keccak256(preimage), expiry);
    await token.getFunction("approve")(escrow.target, 10n);
    await token.getFunction("setFail")(true);
    await expectRevert(create(), "SafeERC20FailedOperation");
    assert.equal((await escrow.getFunction("swaps")(swapId)).sender, ZeroAddress);
    await token.getFunction("setFail")(false);
    await create();
    await token.getFunction("setFail")(true);
    await expectRevert(escrow.connect(bob).getFunction("claim")(swapId, preimage), "SafeERC20FailedOperation");
    assert.equal((await escrow.getFunction("swaps")(swapId)).status, 0n);
    await api.provider.send("evm_setNextBlockTimestamp", [expiry]);
    await api.provider.send("evm_mine", []);
    await expectRevert(escrow.getFunction("refund")(swapId), "SafeERC20FailedOperation");
    assert.equal((await escrow.getFunction("swaps")(swapId)).status, 0n);
    await token.getFunction("setFail")(false);
    await escrow.getFunction("refund")(swapId);
    assert.equal(await token.getFunction("balanceOf")(alice.address), 1000n);
  } finally { await connection.close(); }
});
