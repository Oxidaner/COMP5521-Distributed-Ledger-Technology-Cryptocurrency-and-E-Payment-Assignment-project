import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { Contract, JsonRpcProvider, NonceManager, Wallet, getAddress, toBeHex } from "ethers";
import { checkChain, type Chain, type ReceiptEvidence } from "../shared/protocol.ts";
import { createPrivateOffset, createPrivatePlan, type PrivatePlan, verifyPrivatePlan } from "../shared/privacy.ts";
import { PRIVATE_ABI, claimPrivateSwap, lockPrivateSwap, observePrivateClaim, readPrivateSwap, refundPrivateSwap } from "../shared/private-protocol.ts";
import type { TransactionUpdate } from "../shared/transactions.ts";

type Job = { plan: PrivatePlan; aliceSecret: string; offset: string; transactions: ReceiptEvidence[]; broadcasts: TransactionUpdate[] };
const directory = "deployments/private-swaps";
function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value || value.includes("YOUR_") || value.includes(".example")) throw new Error(`Missing usable ${name}`);
  return value;
}
async function save(job: Job) {
  await mkdir(directory, { recursive: true });
  await writeFile(`${directory}/${job.plan.mstSwapId}.json`, `${JSON.stringify(job, null, 2)}\n`, { mode: 0o600 });
}
async function main() {
  const [command, swapId, chainArg] = process.argv.slice(2);
  if (!["success", "recovery", "inspect", "refund", "claim"].includes(command)) throw new Error("Usage: npm run protocol:private -- <success|recovery|inspect MST_ID|refund MST_ID CHAIN|claim MST_ID CHAIN>");
  const config = JSON.parse(await readFile("src/private-config.json", "utf8"));
  const providers = { ethereum: new JsonRpcProvider(required("ETHEREUM_SEPOLIA_RPC_URL")), arbitrum: new JsonRpcProvider(required("ARBITRUM_SEPOLIA_RPC_URL")) };
  try {
    await Promise.all((["ethereum", "arbitrum"] as const).map(chain => checkChain(providers[chain], chain)));
    const role = (name: string, chain: Chain) => {
      const key = required(`${name}_PRIVATE_KEY`);
      return new NonceManager(new Wallet(key.startsWith("0x") ? key : `0x${key}`, providers[chain]));
    };
    const alice = { ethereum: role("ALICE", "ethereum"), arbitrum: role("ALICE", "arbitrum") };
    const bob = { ethereum: role("BOB", "ethereum"), arbitrum: role("BOB", "arbitrum") };
    if (getAddress(required("ALICE_ADDRESS")) !== await alice.ethereum.getAddress()
      || getAddress(required("BOB_ADDRESS")) !== await bob.ethereum.getAddress()) {
      throw new Error("Configured role addresses do not match their signing keys");
    }
    let job: Job;
    if (command === "success" || command === "recovery") {
      const blocks = await Promise.all(Object.values(providers).map(p => p.getBlock("latest")));
      if (blocks.some(b => !b)) throw new Error("Both chain timestamps are required");
      const offset = createPrivateOffset();
      const generated = createPrivatePlan(config, await alice.ethereum.getAddress(), await bob.ethereum.getAddress(), offset.offsetPoint,
        Math.max(...blocks.map(b => b!.timestamp)), "1", "0.0001", command === "recovery" ? 60 : 600, command === "recovery" ? 120 : 1200);
      job = { ...generated, offset: offset.offset, transactions: [], broadcasts: [] };
      await save(job);
      console.log(`Private MST ID: ${job.plan.mstSwapId}; independent ETH ID: ${job.plan.ethSwapId}`);
    } else {
      if (!/^0x[0-9a-fA-F]{64}$/.test(swapId ?? "")) throw new Error("Pass the private MST swap ID");
      job = JSON.parse(await readFile(`${directory}/${swapId}.json`, "utf8"));
    }
    verifyPrivatePlan(job.plan, job.offset);
    const observe = async (event: TransactionUpdate) => {
      if (event.stage === "pending") {
        job.broadcasts.push(event);
        // Record broadcasts before waiting; CLI recovery can inspect them after interruption.
        await save(job);
        console.log(`${event.chain} ${event.action} broadcast: ${event.hash}`);
      }
    };
    const progress = async (event: ReceiptEvidence) => {
      job.transactions.push(event);
      if (event.action === "private lock") {
        if (event.chain === "ethereum") job.plan.mstLockTx = event.hash;
        else job.plan.ethLockTx = event.hash;
      }
      await save(job);
      console.log(`${event.chain} ${event.action} confirmed: ${event.hash}`);
    };
    const negativeChecks: string[] = [];
    let earlyRefundRejected = false;
    if (command === "success" || command === "recovery") {
      await lockPrivateSwap(alice.ethereum, providers.arbitrum, config, job.plan, "ethereum", "", progress, observe);
      const nonce = await bob.arbitrum.getNonce();
      for (const [label, badPlan, badOffset] of [
        ["invalid Schnorr proof", { ...job.plan, proof: { ...job.plan.proof, response: toBeHex(1, 32) } }, job.offset],
        ["incorrect private offset", job.plan, createPrivateOffset().offset],
      ] as const) {
        await assert.rejects(() => lockPrivateSwap(bob.arbitrum, providers.ethereum, config, badPlan, "arbitrum", badOffset));
        assert.equal(await bob.arbitrum.getNonce(), nonce);
        negativeChecks.push(`${label}: rejected before broadcast; Bob nonce unchanged`);
      }
      await lockPrivateSwap(bob.arbitrum, providers.ethereum, config, job.plan, "arbitrum", job.offset, progress, observe);
    }
    if (command === "success") {
      const first = await claimPrivateSwap(alice.arbitrum, providers.ethereum, config, job.plan, "arbitrum", job.aliceSecret, progress, observe);
      const second = await observePrivateClaim(providers.arbitrum, config, job.plan, first, job.offset);
      assert.notEqual(second, job.aliceSecret);
      await claimPrivateSwap(bob.ethereum, providers.arbitrum, config, job.plan, "ethereum", second, progress, observe);
    }
    if (command === "recovery") {
      try { await new Contract(config.privateEthHtlc, PRIVATE_ABI, bob.arbitrum).refund.staticCall(job.plan.ethSwapId); }
      catch (error) {
        const data = (error as { data?: string }).data;
        if (!data || new Contract(config.privateEthHtlc, PRIVATE_ABI).interface.parseError(data)?.name !== "RefundNotDue") throw error;
        earlyRefundRejected = true;
      }
      assert(earlyRefundRejected, "Recovery missed early-refund window");
      for (const chain of ["arbitrum", "ethereum"] as const) {
        const until = Date.now() + 5 * 60_000;
        while ((await readPrivateSwap(providers[chain], job.plan, chain)).phase === "Active") {
          if (Date.now() > until) throw new Error("Resume with refund MST_ID CHAIN");
          await new Promise(resolve => setTimeout(resolve, 3000));
        }
        await refundPrivateSwap(chain === "ethereum" ? alice.ethereum : bob.arbitrum, config, job.plan, chain, progress, observe);
      }
    }
    if (command === "claim" || command === "refund") {
      if (chainArg !== "ethereum" && chainArg !== "arbitrum") throw new Error("Specify ethereum or arbitrum");
      if (command === "refund") await refundPrivateSwap(chainArg === "ethereum" ? alice.ethereum : bob.arbitrum, config, job.plan, chainArg, progress, observe);
      else {
        const first = job.transactions.find(t => t.chain === "arbitrum" && t.action === "private claim");
        const secret = chainArg === "arbitrum" ? job.aliceSecret : await observePrivateClaim(providers.arbitrum, config, job.plan, first?.hash ?? "", job.offset);
        await claimPrivateSwap(chainArg === "arbitrum" ? alice.arbitrum : bob.ethereum, providers[chainArg === "arbitrum" ? "ethereum" : "arbitrum"], config, job.plan, chainArg, secret, progress, observe);
      }
    }
    const [ethereum, arbitrum] = await Promise.all([readPrivateSwap(providers.ethereum, job.plan, "ethereum"), readPrivateSwap(providers.arbitrum, job.plan, "arbitrum")]);
    console.log(`Private final states: ${ethereum.phase} / ${arbitrum.phase}`);
    if (command === "success" || command === "recovery") {
      const expected = command === "success" ? "Claimed" : "Refunded";
      assert.equal(ethereum.phase, expected); assert.equal(arbitrum.phase, expected);
      // Publish each on-chain leg, not the off-chain relation, proof or either private scalar.
      const leg = (chain: Chain) => {
        const mst = chain === "ethereum";
        return { swapId: mst ? job.plan.mstSwapId : job.plan.ethSwapId, escrow: mst ? config.privateMstHtlc : config.privateEthHtlc,
          point: mst ? job.plan.mstPoint : job.plan.ethPoint, state: mst ? ethereum : arbitrum,
          transactions: job.transactions.filter(t => t.chain === chain) };
      };
      const evidence = { scenario: command, observedAt: new Date().toISOString(), config, ethereum: leg("ethereum"), arbitrum: leg("arbitrum"),
        negativeChecks, earlyRefundRejected, assessmentDisclosure: "This evidence intentionally pairs the two legs for grading. The protocol does not publish the peer transcript, offset point or linkage proof on chain." };
      await writeFile(`docs/evidence/private-${command}.json`, `${JSON.stringify(evidence, null, 2)}\n`);
    }
  } finally { Object.values(providers).forEach(p => p.destroy()); }
}
main().catch((error: unknown) => {
  const code = (error as { code?: string }).code;
  console.error(code ? `Private protocol stopped (${code}); inspect saved broadcasts before retrying` : error instanceof Error ? error.message : "Private protocol failed");
  process.exitCode = 1;
});
