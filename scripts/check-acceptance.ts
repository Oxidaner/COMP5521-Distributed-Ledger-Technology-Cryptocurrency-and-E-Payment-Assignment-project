import { getReceiptWithRetry } from "../shared/receipts.ts";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { Contract, Interface, JsonRpcProvider, getAddress, isHexString } from "ethers";
import { COMMON_ABI, assertLock, checkChain, readSwap, validatePlan, type Chain, type ReceiptEvidence } from "../shared/protocol.ts";

const json = async (file: string) => JSON.parse(await readFile(file, "utf8"));

async function main() {
  const deployment = await json("docs/evidence/deployment.json");
  const config = await json("src/public-config.json");
  assert.equal(deployment.ethereumSepolia.chainId, 11155111);
  assert.equal(deployment.arbitrumSepolia.chainId, 421614);
  for (const [name, address] of Object.entries({ mst: deployment.ethereumSepolia.mst, erc20Htlc: deployment.ethereumSepolia.erc20Htlc, ethHtlc: deployment.arbitrumSepolia.ethHtlc })) {
    assert.equal(getAddress(config[name]), getAddress(address as string), `${name} differs between UI and evidence`);
  }
  const scenarios = await Promise.all(["success", "recovery"].map((name) => json(`docs/evidence/testnet-${name}.json`)));
  for (const evidence of scenarios) {
    validatePlan(evidence.plan);
    assert.deepEqual(evidence.config, { mst: config.mst, erc20Htlc: config.erc20Htlc, ethHtlc: config.ethHtlc });
    assert(!/"(?:preimage|privateKey|mnemonic)"\s*:/i.test(JSON.stringify(evidence)), "Public evidence contains private material");
    const expected = evidence.scenario === "success" ? "Claimed" : "Refunded";
    for (const chain of ["ethereum", "arbitrum"] as const) {
      assertLock(evidence.states[chain], evidence.plan, config, chain, false);
      assert.equal(evidence.states[chain].phase, expected);
      assert.equal(evidence.states[chain].status, expected === "Claimed" ? 1 : 2);
      for (const action of ["lock", expected === "Claimed" ? "claim" : "refund"]) {
        const tx = evidence.transactions.find((tx: ReceiptEvidence) => tx.chain === chain && tx.action === action);
        assert(tx && isHexString(tx.hash, 32) && Number.isSafeInteger(tx.blockNumber), `Missing ${chain} ${action} evidence`);
      }
      const lock = evidence.transactions.find((tx: ReceiptEvidence) => tx.chain === chain && tx.action === "lock");
      assert.equal(lock.hash, chain === "ethereum" ? evidence.plan.mstLockTx : evidence.plan.ethLockTx);
    }
    if (evidence.scenario === "recovery") assert.equal(evidence.earlyRefundRejected, true);
  }
  for (const file of ["README.md", "Changes.md", ".agent/acceptance.md", ".agent/README.md", "docs/demo.md", "docs/contributions.md", "docs/ai-assistance.md", "presentation.pptx"]) {
    assert((await readFile(file)).length > 100, `Missing or empty ${file}`);
  }
  const pdf = await readFile("Report.pdf");
  assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
  const pages = [...pdf.toString("latin1").matchAll(/\/Type\s*\/Page\b/g)].length;
  assert(pages > 0 && pages <= 6, `Report has ${pages} pages, expected at most six`);
  if (process.argv.includes("--submission")) {
    assert(!/\bTBD\b/.test(await readFile("docs/contributions.md", "utf8")), "Fill the real name and student ID before final submission");
  }
  console.log(`Offline acceptance: consistent addresses, both testnet scenarios, ${pages}-page report and presentation present.`);
  if (!process.argv.includes("--live")) return;

  const providers = { ethereum: new JsonRpcProvider(config.ethereumRpc), arbitrum: new JsonRpcProvider(config.arbitrumRpc) };
  let receiptsChecked = 0;
  try {
    for (const chain of ["ethereum", "arbitrum"] as const) await checkChain(providers[chain], chain);
    for (const name of ["MST", "ERC20HTLC", "ETHHTLC"]) {
      const contract = deployment.contracts[name];
      const provider = providers[name === "ETHHTLC" ? "arbitrum" : "ethereum"];
      const receipt = await getReceiptWithRetry(provider, contract.transactionHash);
      assert(receipt && receipt.status === 1 && getAddress(receipt.contractAddress!) === getAddress(contract.address));
      assert.notEqual(await provider.getCode(contract.address), "0x");
      receiptsChecked++;
    }
    assert.equal(getAddress(await new Contract(config.erc20Htlc, ["function token() view returns (address)"], providers.ethereum).token()), getAddress(config.mst));
    const iface = new Interface(COMMON_ABI);
    for (const evidence of scenarios) {
      for (const tx of evidence.transactions as ReceiptEvidence[]) {
        const receipt = await getReceiptWithRetry(providers[tx.chain], tx.hash);
        assert(receipt && receipt.status === 1 && receipt.blockNumber === tx.blockNumber);
        if (tx.action !== "approve") {
          const address = tx.chain === "ethereum" ? config.erc20Htlc : config.ethHtlc;
          const name = { lock: "SwapCreated", claim: "SwapClaimed", refund: "SwapRefunded" }[tx.action];
          assert(receipt.logs.some((log) => {
            if (getAddress(log.address) !== getAddress(address)) return false;
            try { const event = iface.parseLog(log); return event !== null && event.name === name && event.args.swapId === evidence.plan.swapId; } catch { return false; }
          }), `Receipt lacks ${name}`);
        }
        receiptsChecked++;
      }
      for (const chain of ["ethereum", "arbitrum"] as Chain[]) {
        const state = await readSwap(providers[chain], chain === "ethereum" ? config.erc20Htlc : config.ethHtlc, evidence.plan.swapId);
        assertLock(state, evidence.plan, config, chain, false);
        assert.equal(state.phase, evidence.states[chain].phase);
      }
    }
    await writeFile("docs/evidence/live-verification.json", `${JSON.stringify({ verifiedAt: new Date().toISOString(), receiptsChecked, chainIds: [11155111, 421614], success: "Claimed / Claimed", recovery: "Refunded / Refunded", scope: "Read-only receipt, deployed code, token binding and independent state verification. No browser signing or classroom assessment." }, null, 2)}\n`);
    console.log(`Live read-only verification: ${receiptsChecked} successful receipts, deployed code and both chains' final states match.`);
  } finally { Object.values(providers).forEach((provider) => provider.destroy()); }
}

main().catch((error) => {
  console.error(error.code && error.code !== "ERR_ASSERTION" ? `Acceptance failed (${error.code})` : error.message);
  process.exitCode = 1;
});
