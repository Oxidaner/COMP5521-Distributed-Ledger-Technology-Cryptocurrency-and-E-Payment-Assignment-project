import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { Contract, ContractFactory, Interface, JsonRpcProvider, ZeroAddress, getAddress, isHexString, keccak256, toBeHex } from "ethers";
import { checkChain, type Chain } from "../shared/protocol.ts";
import { scalarPoint, type LockPoint } from "../shared/privacy.ts";
import { PRIVATE_ABI, type PrivateState } from "../shared/private-protocol.ts";

const json = async (file: string) => JSON.parse(await readFile(file, "utf8"));
async function main() {
  const config = await json("src/private-config.json");
  const publicConfig = await json("src/public-config.json");
  const deployment = await json("docs/evidence/private-deployment.json");
  assert.equal(getAddress(config.mst), getAddress(publicConfig.mst));
  assert.equal(getAddress(deployment.mst), getAddress(config.mst));
  for (const chain of ["ethereum", "arbitrum"] as const) {
    assert.equal(getAddress(deployment.contracts[chain].address), getAddress(config[chain === "ethereum" ? "privateMstHtlc" : "privateEthHtlc"]));
    assert(isHexString(deployment.contracts[chain].transactionHash, 32));
  }
  const scenarios = await Promise.all(["success", "recovery"].map(name => json(`docs/evidence/private-${name}.json`)));
  for (const evidence of scenarios) {
    assert.deepEqual(evidence.config, config);
    assert(!/"(?:offset|offsetPoint|aliceSecret|proof|privateKey|mnemonic)"\s*:/i.test(JSON.stringify(evidence)), "Private peer material must not be published");
    assert.notEqual(evidence.ethereum.swapId, evidence.arbitrum.swapId);
    assert.notDeepEqual(evidence.ethereum.point, evidence.arbitrum.point);
    assert(evidence.negativeChecks.length >= 2);
    if (evidence.scenario === "recovery") assert.equal(evidence.earlyRefundRejected, true);
    for (const chain of ["ethereum", "arbitrum"] as const) {
      const leg = evidence[chain];
      assert.equal(leg.state.phase, evidence.scenario === "success" ? "Claimed" : "Refunded");
      assert.equal(leg.point.x, leg.state.pointX); assert.equal(leg.point.y, leg.state.pointY);
      assert.equal(getAddress(leg.escrow), getAddress(config[chain === "ethereum" ? "privateMstHtlc" : "privateEthHtlc"]));
      for (const action of ["private lock", evidence.scenario === "success" ? "private claim" : "private refund"]) {
        assert(leg.transactions.some((t: { action: string; chain: string; hash: string; blockNumber: number }) =>
          t.action === action && t.chain === chain && isHexString(t.hash, 32) && Number.isSafeInteger(t.blockNumber)));
      }
    }
    assert(evidence.ethereum.state.timelock > evidence.arbitrum.state.timelock);
    assert.equal(getAddress(evidence.ethereum.state.sender), getAddress(evidence.arbitrum.state.receiver));
    assert.equal(getAddress(evidence.ethereum.state.receiver), getAddress(evidence.arbitrum.state.sender));
  }
  console.log("Private offline acceptance: distinct IDs/points, both final states, failed verification and no peer secrets in public evidence.");
  if (!process.argv.includes("--live")) return;
  const providers = { ethereum: new JsonRpcProvider(publicConfig.ethereumRpc), arbitrum: new JsonRpcProvider(publicConfig.arbitrumRpc) };
  try {
    const artifact = await json("artifacts/contracts/PrivateHTLC.sol/PrivateHTLC.json");
    const iface = new Interface(PRIVATE_ABI);
    let receiptsChecked = 0;
    const claimed: Partial<Record<Chain, string>> = {};
    for (const chain of ["ethereum", "arbitrum"] as const) {
      const provider = providers[chain]; await checkChain(provider, chain);
      const record = deployment.contracts[chain];
      const receipt = await provider.getTransactionReceipt(record.transactionHash);
      assert(receipt && receipt.status === 1 && getAddress(receipt.contractAddress!) === getAddress(record.address));
      const asset = chain === "ethereum" ? config.mst : ZeroAddress;
      const input = await new ContractFactory(artifact.abi, artifact.bytecode).getDeployTransaction(asset);
      assert.equal(keccak256(input.data), record.bytecodeHash);
      const transaction = await provider.getTransaction(record.transactionHash);
      assert(transaction && keccak256(transaction.data) === record.bytecodeHash, "Compiled creation code differs from deployed creation transaction");
      assert.notEqual(await provider.getCode(record.address), "0x");
      const contract = new Contract(record.address, PRIVATE_ABI, provider);
      assert.equal(getAddress(await contract.token()), getAddress(asset));
      receiptsChecked++;
      for (const evidence of scenarios) {
        const leg = evidence[chain];
        for (const tx of leg.transactions) {
          const receipt = await provider.getTransactionReceipt(tx.hash);
          assert(receipt && receipt.status === 1 && receipt.blockNumber === tx.blockNumber);
          if (tx.action !== "private approve") {
            const name = tx.action === "private lock" ? "SwapCreated" : tx.action === "private claim" ? "SwapClaimed" : "SwapRefunded";
            const event = receipt.logs.flatMap(log => {
              if (getAddress(log.address) !== getAddress(record.address)) return [];
              try { const event = iface.parseLog(log); return event?.name === name && event.args.swapId === leg.swapId ? [event] : []; } catch { return []; }
            })[0];
            assert(event, `Missing matching ${name}`);
            if (name === "SwapClaimed") {
              const scalar = toBeHex(event.args.scalar, 32);
              assert.deepEqual(scalarPoint(scalar), leg.point as LockPoint);
              claimed[chain] = scalar;
            }
          }
          receiptsChecked++;
        }
        const state = await contract.swaps(leg.swapId);
        const expected = leg.state as PrivateState;
        assert.equal(getAddress(state.sender), getAddress(expected.sender));
        assert.equal(getAddress(state.receiver), getAddress(expected.receiver));
        assert.equal(state.amount.toString(), expected.amount);
        assert.equal(toBeHex(state.pointX, 32), expected.pointX); assert.equal(toBeHex(state.pointY, 32), expected.pointY);
        assert.equal(Number(state.timelock), expected.timelock);
        assert.equal(Number(state.status), evidence.scenario === "success" ? 1 : 2);
      }
    }
    assert(claimed.ethereum && claimed.arbitrum && claimed.ethereum !== claimed.arbitrum, "Claims must disclose distinct scalars");
    await writeFile("docs/evidence/private-verification.json", `${JSON.stringify({ verifiedAt: new Date().toISOString(), receiptsChecked,
      chainIds: [11155111, 421614], distinctClaimValues: true, success: "Claimed / Claimed", recovery: "Refunded / Refunded",
      scope: "Read-only creation-bytecode, asset binding, successful receipts, distinct on-chain claim values and independent final states. No private peer transcript published; no MetaMask signing assertion." }, null, 2)}\n`);
    console.log(`Private live verification: ${receiptsChecked} receipts, matching compiled deployments, distinct claim values and final states.`);
  } finally { Object.values(providers).forEach(p => p.destroy()); }
}
main().catch(error => {
  console.error(error.code && error.code !== "ERR_ASSERTION" ? `Private acceptance failed (${error.code})` : error.message);
  process.exitCode = 1;
});
