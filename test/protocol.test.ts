import assert from "node:assert/strict";
import { test } from "node:test";
import { isHexString, keccak256 } from "ethers";
import { createHashlockMaterial } from "../shared/hashlock.ts";
import { connectMetaMask, parseChainId, switchMetaMaskNetwork, type Eip1193Provider } from "../shared/wallet.ts";
import { network } from "hardhat";
import { assertLock, claimSwap, createPlan, lockEth, lockMst, readSwap, refundSwap, revealedPreimage, verifyLock } from "../shared/protocol.ts";

test("creates a bytes32 preimage and its matching hashlock", () => {
  const { preimage, hashlock } = createHashlockMaterial();

  assert.equal(isHexString(preimage, 32), true);
  assert.equal(isHexString(hashlock, 32), true);
  assert.equal(hashlock, keccak256(preimage));
});

test("connects to MetaMask and returns the checksummed account and chain ID", async () => {
  const calls: Array<{ method: string; params?: unknown[] }> = [];
  const provider: Eip1193Provider = {
    async request(args) {
      calls.push(args);
      return args.method === "eth_requestAccounts"
        ? ["0x00000000000000000000000000000000000000aa"]
        : "0xaa36a7";
    },
  };

  const wallet = await connectMetaMask(provider);

  assert.equal(wallet.account, "0x00000000000000000000000000000000000000AA");
  assert.equal(wallet.chainId, 11155111);
  assert.deepEqual(calls.map(({ method }) => method), ["eth_requestAccounts", "eth_chainId"]);
});

test("rejects missing wallet and missing account", async () => {
  await assert.rejects(() => connectMetaMask(undefined), /MetaMask was not found/);
  await assert.rejects(
    () => connectMetaMask({ request: async () => [] }),
    /did not return an account/,
  );
});

test("switches MetaMask to the requested assignment network", async () => {
  let request: { method: string; params?: unknown[] } | undefined;
  const provider: Eip1193Provider = {
    async request(args) {
      request = args;
      return null;
    },
  };

  await switchMetaMaskNetwork(421614, provider);

  assert.deepEqual(request, {
    method: "wallet_switchEthereumChain",
    params: [{ chainId: "0x66eee" }],
  });
});

test("parses valid hexadecimal chain IDs and rejects malformed values", () => {
  assert.equal(parseChainId("0xaa36a7"), 11155111);
  assert.equal(parseChainId("0x66eee"), 421614);
  assert.equal(parseChainId("11155111"), null);
  assert.equal(parseChainId(null), null);
});

test("two independent chains complete a verified atomic swap and timeout recovery", async () => {
  const ethereum = await network.create("mstLocal");
  const arbitrum = await network.create("ethLocal");
  try {
    const [alice, bob] = await ethereum.ethers.getSigners();
    const [aliceEth, bobEth] = await arbitrum.ethers.getSigners();
    const mst = await ethereum.ethers.deployContract("MST", [10n ** 24n], alice);
    const erc20 = await ethereum.ethers.deployContract("ERC20HTLC", [mst.target], alice);
    const eth = await arbitrum.ethers.deployContract("ETHHTLC", [], bobEth);
    const config = { mst: await mst.getAddress(), erc20Htlc: await erc20.getAddress(), ethHtlc: await eth.getAddress() };
    const block = await ethereum.ethers.provider.getBlock("latest");
    const { plan, preimage } = createPlan(alice.address, bob.address, block!.timestamp);

    await assert.rejects(() => lockEth(bobEth, ethereum.ethers.provider, config, plan), /confirmed lock transaction/);
    plan.mstLockTx = await lockMst(alice, config, plan);
    const mstState = await verifyLock(ethereum.ethers.provider, config, plan, "ethereum");
    assert.throws(() => assertLock(mstState, { ...plan, mstAmount: "7" }, config, "ethereum"), /parameters/);
    await assert.rejects(() => verifyLock(ethereum.ethers.provider, config, { ...plan, mstLockTx: `0x${"99".repeat(32)}` }, "ethereum"), /unconfirmed/);
    await assert.rejects(() => lockEth(aliceEth, ethereum.ethers.provider, config, plan), /Connect Bob/);
    plan.ethLockTx = await lockEth(bobEth, ethereum.ethers.provider, config, plan);
    await assert.rejects(() => claimSwap(aliceEth, ethereum.ethers.provider, config, plan, "arbitrum", `0x${"ff".repeat(32)}`), /Wrong preimage/);
    const ethClaim = await claimSwap(aliceEth, ethereum.ethers.provider, config, plan, "arbitrum", preimage);
    const publicPreimage = await revealedPreimage(arbitrum.ethers.provider, config, plan, ethClaim);
    assert.equal(publicPreimage, preimage);
    await claimSwap(bob, arbitrum.ethers.provider, config, plan, "ethereum", publicPreimage);
    assert.equal((await readSwap(ethereum.ethers.provider, config.erc20Htlc, plan.swapId)).phase, "Claimed");
    assert.equal((await readSwap(arbitrum.ethers.provider, config.ethHtlc, plan.swapId)).phase, "Claimed");

    const fresh = await ethereum.ethers.provider.getBlock("latest");
    const recovery = createPlan(alice.address, bob.address, fresh!.timestamp, "1", "0.001", 30, 60).plan;
    recovery.mstLockTx = await lockMst(alice, config, recovery);
    recovery.ethLockTx = await lockEth(bobEth, ethereum.ethers.provider, config, recovery);
    await assert.rejects(() => refundSwap(bobEth, config, recovery, "arbitrum"), /only for an expired/);
    await arbitrum.ethers.provider.send("evm_setNextBlockTimestamp", [recovery.ethTimelock]);
    await arbitrum.ethers.provider.send("evm_mine", []);
    assert.equal((await readSwap(ethereum.ethers.provider, config.erc20Htlc, recovery.swapId)).phase, "Active");
    assert.equal((await readSwap(arbitrum.ethers.provider, config.ethHtlc, recovery.swapId)).phase, "Expired");
    await refundSwap(bobEth, config, recovery, "arbitrum");
    await ethereum.ethers.provider.send("evm_setNextBlockTimestamp", [recovery.mstTimelock]);
    await ethereum.ethers.provider.send("evm_mine", []);
    await refundSwap(alice, config, recovery, "ethereum");
    assert.equal((await readSwap(ethereum.ethers.provider, config.erc20Htlc, recovery.swapId)).phase, "Refunded");
    assert.equal((await readSwap(arbitrum.ethers.provider, config.ethHtlc, recovery.swapId)).phase, "Refunded");
    await assert.rejects(() => refundSwap(alice, config, recovery, "ethereum"), /only for an expired/);
  } finally {
    await ethereum.close();
    await arbitrum.close();
  }
});
