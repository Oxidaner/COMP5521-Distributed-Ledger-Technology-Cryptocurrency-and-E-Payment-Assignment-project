import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { Contract, JsonRpcProvider, NonceManager, Wallet, formatEther, getAddress } from "ethers";
import {
  TOKEN_ABI, ETH_ABI, checkChain, claimSwap, createPlan, lockEth, lockMst,
  readSwap, refundSwap, revealedPreimage,
  type Chain, type Configuration, type ReceiptEvidence, type SwapPlan,
} from "../shared/protocol.ts";

type Job = { plan: SwapPlan; preimage: string; transactions: ReceiptEvidence[] };
const localDir = "deployments/swaps";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value || value.includes("YOUR_") || value.includes(".example")) throw new Error(`Missing usable ${name}`);
  return value;
}

function key(role: "ALICE" | "BOB"): string {
  const value = required(`${role}_PRIVATE_KEY`);
  return value.startsWith("0x") ? value : `0x${value}`;
}

async function save(job: Job): Promise<void> {
  await mkdir(localDir, { recursive: true });
  await writeFile(join(localDir, `${job.plan.swapId}.json`), `${JSON.stringify(job, null, 2)}\n`, { mode: 0o600 });
}

async function load(swapId?: string): Promise<Job> {
  if (!swapId || !/^0x[0-9a-fA-F]{64}$/.test(swapId)) throw new Error("Pass the bytes32 swap ID printed by create/success/recovery");
  return JSON.parse(await readFile(join(localDir, `${basename(swapId)}.json`), "utf8")) as Job;
}

async function main(): Promise<void> {
  const [command, argument, chainArg] = process.argv.slice(2);
  if (!command || command === "help") {
    console.log("Usage: npm run protocol -- <success|recovery|create|inspect SWAP_ID|claim SWAP_ID ethereum|claim SWAP_ID arbitrum|refund SWAP_ID ethereum|refund SWAP_ID arbitrum>");
    return;
  }
  const providers = {
    ethereum: new JsonRpcProvider(required("ETHEREUM_SEPOLIA_RPC_URL")),
    arbitrum: new JsonRpcProvider(required("ARBITRUM_SEPOLIA_RPC_URL")),
  };
  try {
    await Promise.all(Object.entries(providers).map(([chain, provider]) => checkChain(provider, chain as Chain)));
    const config: Configuration = {
      mst: getAddress(required("MST_ADDRESS")),
      erc20Htlc: getAddress(required("ERC20_HTLC_ADDRESS")),
      ethHtlc: getAddress(required("ETH_HTLC_ADDRESS")),
    };
    const signers = {
      alice: { ethereum: new NonceManager(new Wallet(key("ALICE"), providers.ethereum)), arbitrum: new NonceManager(new Wallet(key("ALICE"), providers.arbitrum)) },
      bob: { ethereum: new NonceManager(new Wallet(key("BOB"), providers.ethereum)), arbitrum: new NonceManager(new Wallet(key("BOB"), providers.arbitrum)) },
    };
    const alice = await signers.alice.ethereum.getAddress();
    const bob = await signers.bob.ethereum.getAddress();
    if (getAddress(required("ALICE_ADDRESS")) !== alice || getAddress(required("BOB_ADDRESS")) !== bob) throw new Error("Configured role addresses do not match their signing keys");

    let job: Job;
    if (["create", "success", "recovery"].includes(command)) {
      const [mstBlock, ethBlock] = await Promise.all([providers.ethereum.getBlock("latest"), providers.arbitrum.getBlock("latest")]);
      if (!mstBlock || !ethBlock) throw new Error("Latest blocks unavailable");
      const recovery = command === "recovery";
      const generated = createPlan(alice, bob, Math.max(mstBlock.timestamp, ethBlock.timestamp), process.env.MST_SWAP_AMOUNT ?? "1", process.env.ETH_SWAP_AMOUNT ?? "0.0001",
        recovery ? 45 : Number(process.env.ETH_DURATION_SECONDS ?? 600), recovery ? 90 : Number(process.env.MST_DURATION_SECONDS ?? 1200));
      job = { ...generated, transactions: [] };
      await save(job);
      console.log(`Swap ID: ${job.plan.swapId}`);
      console.log(`Private recovery material saved locally in ${localDir}; it is not printed or published.`);
    } else {
      job = await load(argument);
    }
    const progress = async (event: ReceiptEvidence) => {
      job.transactions.push(event);
      if (event.action === "lock") {
        if (event.chain === "ethereum") job.plan.mstLockTx = event.hash;
        else job.plan.ethLockTx = event.hash;
      }
      await save(job);
      console.log(`${event.chain} ${event.action} confirmed: ${event.hash}`);
    };
    const inspect = async () => {
      const [ethereum, arbitrum] = await Promise.all([
        readSwap(providers.ethereum, config.erc20Htlc, job.plan.swapId),
        readSwap(providers.arbitrum, config.ethHtlc, job.plan.swapId),
      ]);
      return { ethereum, arbitrum };
    };

    if (["create", "success", "recovery"].includes(command)) {
      const token = new Contract(config.mst, TOKEN_ABI, providers.ethereum);
      if (await token.balanceOf(alice) < BigInt(job.plan.mstAmount)) throw new Error("Alice needs MST from the deploying account before locking");
      console.log(`Swap amounts: ${formatEther(job.plan.mstAmount)} MST / ${formatEther(job.plan.ethAmount)} ETH`);
      await lockMst(signers.alice.ethereum, config, job.plan, progress);
      await lockEth(signers.bob.arbitrum, providers.ethereum, config, job.plan, progress);
    }
    if (command === "success") {
      const claimTx = await claimSwap(signers.alice.arbitrum, providers.ethereum, config, job.plan, "arbitrum", job.preimage, progress);
      const revealed = await revealedPreimage(providers.arbitrum, config, job.plan, claimTx);
      await claimSwap(signers.bob.ethereum, providers.arbitrum, config, job.plan, "ethereum", revealed, progress);
    }
    let earlyRefundRejected = false;
    if (command === "recovery") {
      try {
        await new Contract(config.ethHtlc, ETH_ABI, signers.bob.arbitrum).refund.staticCall(job.plan.swapId);
      } catch (error) {
        if ((error as { code?: string }).code !== "CALL_EXCEPTION") throw error;
        const data = (error as { data?: string }).data;
        const escrow = new Contract(config.ethHtlc, ETH_ABI);
        if (!data || escrow.interface.parseError(data)?.name !== "RefundNotDue") throw new Error("Unexpected early refund failure");
        earlyRefundRejected = true;
        console.log("Before expiry: refund rejected with RefundNotDue (read-only simulation, no gas spent).");
      }
      if (!earlyRefundRejected) throw new Error("Recovery demo missed the early-refund window; retry with fresh deadlines");
      for (const chain of ["arbitrum", "ethereum"] as const) {
        console.log(`Waiting for ${chain} deadline using that chain's block timestamp...`);
        const deadline = Date.now() + 5 * 60_000;
        while ((await readSwap(providers[chain], chain === "ethereum" ? config.erc20Htlc : config.ethHtlc, job.plan.swapId)).phase === "Active") {
          if (Date.now() >= deadline) throw new Error("Deadline wait timed out; use refund SWAP_ID CHAIN to resume");
          await new Promise((resolve) => setTimeout(resolve, 3000));
        }
        await refundSwap(chain === "ethereum" ? signers.alice.ethereum : signers.bob.arbitrum, config, job.plan, chain, progress);
      }
    }
    if (command === "claim" || command === "refund") {
      if (chainArg !== "ethereum" && chainArg !== "arbitrum") throw new Error("Specify ethereum or arbitrum");
      if (command === "refund") await refundSwap(chainArg === "ethereum" ? signers.alice.ethereum : signers.bob.arbitrum, config, job.plan, chainArg, progress);
      else {
        const ethClaim = job.transactions.find((event) => event.chain === "arbitrum" && event.action === "claim");
        const secret = chainArg === "ethereum"
          ? await revealedPreimage(providers.arbitrum, config, job.plan, ethClaim?.hash ?? "") : job.preimage;
        await claimSwap(chainArg === "ethereum" ? signers.bob.ethereum : signers.alice.arbitrum, providers[chainArg === "ethereum" ? "arbitrum" : "ethereum"], config, job.plan, chainArg, secret, progress);
      }
    }
    const states = await inspect();
    console.log(`Independent final states: Ethereum=${states.ethereum.phase}; Arbitrum=${states.arbitrum.phase}`);
    if (command === "success" || command === "recovery") {
      const expected = command === "success" ? "Claimed" : "Refunded";
      if (states.ethereum.phase !== expected || states.arbitrum.phase !== expected) throw new Error("Unexpected final state");
      await mkdir("docs/evidence", { recursive: true });
      const evidence = { scenario: command, observedAt: new Date().toISOString(), config, plan: job.plan, transactions: job.transactions, earlyRefundRejected, states };
      await writeFile(`docs/evidence/testnet-${command}.json`, `${JSON.stringify(evidence, null, 2)}\n`);
      console.log(`Public evidence saved to docs/evidence/testnet-${command}.json`);
    }
  } finally {
    Object.values(providers).forEach((provider) => provider.destroy());
  }
}

main().catch((error: unknown) => {
  const code = (error as { code?: string }).code;
  console.error(code ? `Protocol stopped (${code}); local swap records are preserved for recovery` : error instanceof Error ? error.message : "Protocol failed");
  process.exitCode = 1;
});
