import assert from "node:assert/strict";
import { test } from "node:test";
import { Interface, ZeroAddress, randomBytes, hexlify, toBeHex } from "ethers";
import { network } from "hardhat";
import { createPrivateOffset, createPrivatePlan, derivePrivateClaim, importPrivateSwap, scalarPoint, SCALAR_ORDER, verifyPrivatePlan } from "../shared/privacy.ts";
import { PRIVATE_ABI, claimPrivateSwap, lockPrivateSwap, observePrivateClaim, readPrivateSwap, refundPrivateSwap } from "../shared/private-protocol.ts";
import { switchMetaMaskNetwork } from "../shared/wallet.ts";
import { submitTransaction, type TransactionUpdate } from "../shared/transactions.ts";

const aliceAddress = "0x0000000000000000000000000000000000000001";
const bobAddress = "0x0000000000000000000000000000000000000002";
const configuration = { mst: aliceAddress, privateMstHtlc: bobAddress, privateEthHtlc: "0x0000000000000000000000000000000000000003" };

test("Schnorr proof binds distinct points, identifiers, deployment and all agreed terms", () => {
  const bob = createPrivateOffset();
  const { plan, aliceSecret } = createPrivatePlan(configuration, aliceAddress, bobAddress, bob.offsetPoint, 1_800_000_000);
  verifyPrivatePlan(plan, bob.offset);
  assert.notEqual(plan.mstSwapId, plan.ethSwapId);
  assert.notDeepEqual(plan.mstPoint, plan.ethPoint);
  const second = derivePrivateClaim(plan, aliceSecret, bob.offset);
  assert.notEqual(second, aliceSecret);
  assert.deepEqual(scalarPoint(second), plan.mstPoint);
  for (const altered of [
    { ...plan, mstAmount: "2" }, { ...plan, ethAmount: "3" }, { ...plan, alice: plan.bob, bob: plan.alice },
    { ...plan, privateMstHtlc: plan.privateEthHtlc }, { ...plan, mstSwapId: hexlify(randomBytes(32)) },
    { ...plan, ethTimelock: plan.ethTimelock - 1 }, { ...plan, mstTimelock: plan.mstTimelock + 1 },
    { ...plan, proof: { ...plan.proof, response: toBeHex(1, 32) } },
    { ...plan, mstPoint: scalarPoint(toBeHex(2, 32)) },
  ]) assert.throws(() => verifyPrivatePlan(altered));
  assert.throws(() => verifyPrivatePlan(plan, createPrivateOffset().offset), /offset does not match/);
  assert.throws(() => derivePrivateClaim(plan, toBeHex(1, 32), bob.offset), /first claim value/);
  for (const bad of [null, [], {}, { ...plan, mstAmount: true }, { ...plan, mstPoint: { x: "0x00", y: "0x00" } },
    { ...plan, proof: null }, { ...plan, ethSwapId: plan.mstSwapId }]) assert.throws(() => verifyPrivatePlan(bad));
});

test("private import preserves only matching local secrets and known lock receipts", () => {
  const bob = createPrivateOffset();
  const generated = createPrivatePlan(configuration, aliceAddress, bobAddress, bob.offsetPoint, 1_800_000_000);
  const current = { ...generated, offset: bob.offset };
  const updated = { ...generated.plan, mstLockTx: hexlify(randomBytes(32)), ethLockTx: hexlify(randomBytes(32)) };
  const merged = importPrivateSwap(updated, current);
  assert.equal(merged.aliceSecret, generated.aliceSecret);
  assert.equal(merged.offset, bob.offset);
  assert.equal(importPrivateSwap(generated, merged).plan.ethLockTx, updated.ethLockTx);
  assert(!("aliceSecret" in merged.plan));
  assert(!("offset" in merged.plan));
  const next = createPrivatePlan(configuration, aliceAddress, bobAddress, bob.offsetPoint, 1_800_000_000);
  assert.equal(importPrivateSwap(next.plan, merged).offset, "");
  assert.throws(() => importPrivateSwap({ plan: updated, offset: createPrivateOffset().offset }), /offset does not match/);
});

test("wallet adds an unknown network, switches explicitly, and preserves rejection errors", async () => {
  const calls: { method: string; params?: unknown[] }[] = [];
  await switchMetaMaskNetwork(421614, { request: async args => {
    calls.push(args);
    if (calls.length === 1) throw Object.assign(new Error("Unknown network"), { code: 4902 });
  } });
  assert.deepEqual(calls.map(c => c.method), ["wallet_switchEthereumChain", "wallet_addEthereumChain", "wallet_switchEthereumChain"]);
  const added = calls[1].params![0] as { chainId: string; nativeCurrency: { decimals: number }; rpcUrls: string[] };
  assert.equal(added.chainId, "0x66eee");
  assert.equal(added.nativeCurrency.decimals, 18);
  assert.equal(added.rpcUrls[0], "https://sepolia-rollup.arbitrum.io/rpc");
  const rejection = Object.assign(new Error("Rejected"), { code: 4001 });
  let count = 0;
  await assert.rejects(() => switchMetaMaskNetwork(11155111, { request: async () => { count++; throw rejection; } }), e => e === rejection);
  assert.equal(count, 1);
});

test("transaction hash is reported before confirmation and a rejected signature is not broadcast", async () => {
  const stages: TransactionUpdate[] = [];
  let settle!: (receipt: any) => void;
  const receipt = { hash: `0x${"11".repeat(32)}`, status: 1, blockNumber: 42 };
  const awaitingReceipt = new Promise<any>(resolve => { settle = resolve; });
  const running = submitTransaction(async () => ({ hash: receipt.hash, wait: () => awaitingReceipt }), "ethereum", "lock", undefined, event => { stages.push(event); });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(stages.map(s => s.stage), ["signature", "pending"]);
  assert.equal((stages[1] as { hash: string }).hash, receipt.hash);
  settle(receipt);
  await running;
  assert.equal(stages[2].stage, "confirmed");
  const refused: TransactionUpdate[] = [];
  await assert.rejects(() => submitTransaction(async () => { throw new Error("Rejected"); }, "arbitrum", "claim", undefined, event => { refused.push(event); }), /Rejected/);
  assert.deepEqual(refused.map(s => s.stage), ["signature"]);
  for (const wait of [async () => ({ ...receipt, status: 0 }), async () => { throw new Error("RPC unavailable"); }]) {
    const failed: TransactionUpdate[] = [];
    await assert.rejects(() => submitTransaction(async () => ({ hash: receipt.hash, wait: wait as any }), "ethereum", "claim", undefined,
      event => { failed.push(event); }));
    assert.deepEqual(failed.map(s => s.stage), ["signature", "pending", "attention"]);
    assert.equal((failed[2] as { hash: string }).hash, receipt.hash);
  }
});

test("two independent chains complete private claims; invalid proof or offset cannot counter-lock", async () => {
  const ethereum = await network.create("mstLocal"), arbitrum = await network.create("ethLocal");
  try {
    const [alice, bob, outsider] = await ethereum.ethers.getSigners();
    const [aliceEth, bobEth] = await arbitrum.ethers.getSigners();
    const token = await ethereum.ethers.deployContract("MST", [10n ** 24n]);
    const mstEscrow = await ethereum.ethers.deployContract("PrivateHTLC", [token.target]);
    const ethEscrow = await arbitrum.ethers.deployContract("PrivateHTLC", [ZeroAddress]);
    const config = { mst: await token.getAddress(), privateMstHtlc: await mstEscrow.getAddress(), privateEthHtlc: await ethEscrow.getAddress() };
    const timestamp = Math.max((await ethereum.ethers.provider.getBlock("latest"))!.timestamp, (await arbitrum.ethers.provider.getBlock("latest"))!.timestamp);
    const bobPrivate = createPrivateOffset();
    const { plan, aliceSecret } = createPrivatePlan(config, alice.address, bob.address, bobPrivate.offsetPoint, timestamp);
    const submissions: TransactionUpdate[] = [];
    plan.mstLockTx = await lockPrivateSwap(alice, arbitrum.ethers.provider, config, plan, "ethereum", "", undefined, e => { submissions.push(e); });
    const bobNonce = await bobEth.getNonce();
    const invalid = { ...plan, proof: { ...plan.proof, response: toBeHex(1, 32) } };
    await assert.rejects(() => lockPrivateSwap(bobEth, ethereum.ethers.provider, config, invalid, "arbitrum", bobPrivate.offset), /Schnorr proof/);
    await assert.rejects(() => lockPrivateSwap(bobEth, ethereum.ethers.provider, config, plan, "arbitrum", createPrivateOffset().offset), /offset does not match/);
    await assert.rejects(() => lockPrivateSwap(bobEth, ethereum.ethers.provider, config, { ...plan, mstPoint: scalarPoint(toBeHex(2, 32)) }, "arbitrum", bobPrivate.offset), /Unrelated/);
    assert.equal(await bobEth.getNonce(), bobNonce);
    assert.equal((await readPrivateSwap(arbitrum.ethers.provider, plan, "arbitrum")).phase, "Missing");
    plan.ethLockTx = await lockPrivateSwap(bobEth, ethereum.ethers.provider, config, plan, "arbitrum", bobPrivate.offset);
    await assert.rejects(() => mstEscrow.connect(outsider).getFunction("claim")(plan.mstSwapId, aliceSecret));
    await assert.rejects(() => claimPrivateSwap(bob, arbitrum.ethers.provider, config, plan, "ethereum", aliceSecret), /does not match/);
    await assert.rejects(() => refundPrivateSwap(bobEth, config, plan, "arbitrum"), /only after expiry/);
    const first = await claimPrivateSwap(aliceEth, ethereum.ethers.provider, config, plan, "arbitrum", aliceSecret);
    const second = await observePrivateClaim(arbitrum.ethers.provider, config, plan, first, bobPrivate.offset);
    assert.notEqual(second, aliceSecret);
    await claimPrivateSwap(bob, arbitrum.ethers.provider, config, plan, "ethereum", second);
    assert.equal((await readPrivateSwap(ethereum.ethers.provider, plan, "ethereum")).phase, "Claimed");
    assert.equal((await readPrivateSwap(arbitrum.ethers.provider, plan, "arbitrum")).phase, "Claimed");
    assert.equal(await token.balanceOf(bob.address), BigInt(plan.mstAmount));
    await assert.rejects(() => mstEscrow.getFunction("refund")(plan.mstSwapId));
    await assert.rejects(() => mstEscrow.connect(bob).getFunction("claim")(plan.mstSwapId, second));
    assert.deepEqual(submissions.map(s => s.stage), ["signature", "pending", "confirmed", "signature", "pending", "confirmed"]);
    const iface = new Interface(PRIVATE_ABI);
    const receipt = await arbitrum.ethers.provider.getTransactionReceipt(first);
    assert.equal(iface.parseLog(receipt!.logs.at(-1)!)!.args.scalar, BigInt(aliceSecret));
  } finally { await ethereum.close(); await arbitrum.close(); }
});

test("private escrow rejects invalid curve points, duplicate locks and noncanonical scalars", async () => {
  const chain = await network.create("ethLocal");
  try {
    const [alice, bob] = await chain.ethers.getSigners();
    const escrow = await chain.ethers.deployContract("PrivateHTLC", [ZeroAddress]);
    const now = (await chain.ethers.provider.getBlock("latest"))!.timestamp;
    const id = hexlify(randomBytes(32));
    const field = await escrow.getFunction("FIELD")();
    for (const [x, y] of [[0n, 0n], [1n, 1n], [field + 1n, 2n]]) {
      await assert.rejects(() => escrow.createSwap(id, bob.address, 1n, x, y, now + 100, { value: 1n }));
    }
    await assert.rejects(() => escrow.createSwap(id, bob.address, 1n, 1n, 2n, now + 100));
    await assert.rejects(() => escrow.createSwap(id, alice.address, 1n, 1n, 2n, now + 100, { value: 1n }));
    const secret = toBeHex(SCALAR_ORDER - 1n, 32), point = scalarPoint(secret);
    await escrow.createSwap(id, bob.address, 1n, point.x, point.y, now + 100, { value: 1n });
    await assert.rejects(() => escrow.createSwap(id, bob.address, 1n, 1n, 2n, now + 100, { value: 1n }));
    for (const bad of [0n, 1n, SCALAR_ORDER, 2n * SCALAR_ORDER - 1n]) {
      await assert.rejects(() => escrow.connect(bob).getFunction("claim")(id, bad));
      assert.equal((await escrow.swaps(id)).status, 0n);
    }
    await escrow.connect(bob).getFunction("claim")(id, secret);
    assert.equal((await escrow.swaps(id)).status, 1n);
  } finally { await chain.close(); }
});

test("private transfer failures roll back completion and receiver reentry cannot drain escrow", async () => {
  const chain = await network.create("ethLocal");
  try {
    const [alice, bob] = await chain.ethers.getSigners();
    const escrow = await chain.ethers.deployContract("PrivateHTLC", [ZeroAddress]);
    const probe = await chain.ethers.deployContract("PrivateReceiverProbe");
    const id = hexlify(randomBytes(32)), secret = toBeHex(7, 32), point = scalarPoint(secret);
    const now = (await chain.ethers.provider.getBlock("latest"))!.timestamp;
    await probe.configure(escrow.target, id, secret, true);
    await escrow.createSwap(id, probe.target, 5n, point.x, point.y, now + 100, { value: 5n });
    await assert.rejects(() => probe.claim());
    assert.equal((await escrow.swaps(id)).status, 0n);
    assert.equal(await chain.ethers.provider.getBalance(escrow.target), 5n);
    await probe.configure(escrow.target, id, secret, false);
    await probe.claim();
    assert.equal(await probe.reentrySucceeded(), false);
    assert.equal(await chain.ethers.provider.getBalance(probe.target), 5n);
    const refundId = hexlify(randomBytes(32));
    await probe.configure(escrow.target, refundId, secret, false);
    await probe.lock(bob.address, point.x, point.y, now + 100, { value: 5n });
    await chain.ethers.provider.send("evm_setNextBlockTimestamp", [now + 100]);
    await chain.ethers.provider.send("evm_mine", []);
    await assert.rejects(() => escrow.connect(bob).getFunction("claim")(refundId, secret));
    await probe.configure(escrow.target, refundId, secret, true);
    await assert.rejects(() => probe.refund());
    assert.equal((await escrow.swaps(refundId)).status, 0n);
    await probe.configure(escrow.target, refundId, secret, false);
    await probe.refund();
    assert.equal((await escrow.swaps(refundId)).status, 2n);

    const token = await chain.ethers.deployContract("FailingTokenProbe");
    const tokenEscrow = await chain.ethers.deployContract("PrivateHTLC", [token.target]);
    const tokenId = hexlify(randomBytes(32)), deadline = now + 300;
    await token.approve(tokenEscrow.target, 100n);
    await token.setFail(true);
    await assert.rejects(() => tokenEscrow.createSwap(tokenId, bob.address, 100n, point.x, point.y, deadline));
    assert.equal((await tokenEscrow.swaps(tokenId)).sender, ZeroAddress);
    await token.setFail(false);
    await tokenEscrow.createSwap(tokenId, bob.address, 100n, point.x, point.y, deadline);
    await token.setFail(true);
    await assert.rejects(() => tokenEscrow.connect(bob).getFunction("claim")(tokenId, secret));
    assert.equal((await tokenEscrow.swaps(tokenId)).status, 0n);
    await chain.ethers.provider.send("evm_setNextBlockTimestamp", [deadline]);
    await chain.ethers.provider.send("evm_mine", []);
    await assert.rejects(() => tokenEscrow.refund(tokenId));
    assert.equal((await tokenEscrow.swaps(tokenId)).status, 0n);
    await token.setFail(false);
    await tokenEscrow.refund(tokenId);
    assert.equal((await tokenEscrow.swaps(tokenId)).status, 2n);
  } finally { await chain.close(); }
});

test("point escrow validates curve membership, canonical scalars and exact timeout recovery", async () => {
  const ethereum = await network.create("mstLocal"), arbitrum = await network.create("ethLocal");
  try {
    const [alice, bob] = await ethereum.ethers.getSigners();
    const [aliceEth, bobEth] = await arbitrum.ethers.getSigners();
    const token = await ethereum.ethers.deployContract("MST", [1000n]);
    const mst = await ethereum.ethers.deployContract("PrivateHTLC", [token.target]);
    const eth = await arbitrum.ethers.deployContract("PrivateHTLC", [ZeroAddress]);
    const config = { mst: await token.getAddress(), privateMstHtlc: await mst.getAddress(), privateEthHtlc: await eth.getAddress() };
    const timestamp = Math.max((await ethereum.ethers.provider.getBlock("latest"))!.timestamp, (await arbitrum.ethers.provider.getBlock("latest"))!.timestamp);
    const offset = createPrivateOffset();
    const { plan } = createPrivatePlan(config, alice.address, bob.address, offset.offsetPoint, timestamp, "0.00000000000000001", "0.0001", 30, 60);
    const id = hexlify(randomBytes(32)), p = scalarPoint(toBeHex(SCALAR_ORDER - 1n, 32));
    for (const [x, y] of [[0n, 0n], [1n, 1n], [2n ** 256n - 1n, 2n]]) {
      await assert.rejects(() => eth.connect(bobEth).getFunction("createSwap")(id, aliceEth.address, 1n, x, y, timestamp + 30, { value: 1n }));
    }
    await assert.rejects(() => eth.connect(bobEth).getFunction("createSwap")(id, aliceEth.address, 1n, p.x, p.y, timestamp + 30, { value: 2n }));
    await eth.connect(bobEth).getFunction("createSwap")(id, aliceEth.address, 1n, p.x, p.y, timestamp + 30, { value: 1n });
    for (const invalid of [0n, SCALAR_ORDER, SCALAR_ORDER + 1n]) await assert.rejects(() => eth.connect(aliceEth).getFunction("claim")(id, invalid));
    await eth.connect(aliceEth).getFunction("claim")(id, SCALAR_ORDER - 1n);
    plan.mstLockTx = await lockPrivateSwap(alice, arbitrum.ethers.provider, config, plan, "ethereum");
    plan.ethLockTx = await lockPrivateSwap(bobEth, ethereum.ethers.provider, config, plan, "arbitrum", offset.offset);
    await arbitrum.ethers.provider.send("evm_setNextBlockTimestamp", [plan.ethTimelock]);
    await arbitrum.ethers.provider.send("evm_mine", []);
    assert.equal((await readPrivateSwap(arbitrum.ethers.provider, plan, "arbitrum")).phase, "Expired");
    assert.equal((await readPrivateSwap(ethereum.ethers.provider, plan, "ethereum")).phase, "Active");
    await assert.rejects(() => refundPrivateSwap(aliceEth, config, plan, "arbitrum"), /sender/);
    await refundPrivateSwap(bobEth, config, plan, "arbitrum");
    await ethereum.ethers.provider.send("evm_setNextBlockTimestamp", [plan.mstTimelock]);
    await ethereum.ethers.provider.send("evm_mine", []);
    await refundPrivateSwap(alice, config, plan, "ethereum");
    assert.equal((await readPrivateSwap(arbitrum.ethers.provider, plan, "arbitrum")).phase, "Refunded");
    assert.equal((await readPrivateSwap(ethereum.ethers.provider, plan, "ethereum")).phase, "Refunded");
    assert.equal(await token.balanceOf(alice.address), 1000n);
    await assert.rejects(() => mst.getFunction("refund")(plan.mstSwapId));
  } finally { await ethereum.close(); await arbitrum.close(); }
});
