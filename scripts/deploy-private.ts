import { readFile, writeFile } from "node:fs/promises";
import { Contract, ContractFactory, JsonRpcProvider, Wallet, ZeroAddress, getAddress, keccak256 } from "ethers";
import { checkChain, type Chain } from "../shared/protocol.ts";

const manifestPath = "docs/evidence/private-deployment.json";
type DeploymentRecord = { address: string; transactionHash: string; bytecodeHash: string; blockNumber?: number };
type Manifest = { deployedAt: string; mst: string; contracts: Partial<Record<Chain, DeploymentRecord>> };
const required = (name: string) => {
  const value = process.env[name]?.trim();
  if (!value || value.includes("YOUR_") || value.includes(".example")) throw new Error(`Missing usable ${name}`);
  return value;
};

async function main() {
  const existing = JSON.parse(await readFile("src/public-config.json", "utf8"));
  const compiled = JSON.parse(await readFile("artifacts/contracts/PrivateHTLC.sol/PrivateHTLC.json", "utf8"));
  const raw = process.env.DEPLOYER_PRIVATE_KEY?.trim();
  const key = raw && !raw.includes("YOUR_") ? raw : required("ALICE_PRIVATE_KEY");
  const providers = {
    ethereum: new JsonRpcProvider(required("ETHEREUM_SEPOLIA_RPC_URL")),
    arbitrum: new JsonRpcProvider(required("ARBITRUM_SEPOLIA_RPC_URL")),
  };
  try {
    let manifest: Manifest;
    try { manifest = JSON.parse(await readFile(manifestPath, "utf8")); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      manifest = { deployedAt: new Date().toISOString(), mst: existing.mst, contracts: {} };
    }
    if (getAddress(manifest.mst) !== getAddress(existing.mst)) throw new Error("Private deployment token differs");
    for (const chain of ["ethereum", "arbitrum"] as const) {
      const provider = providers[chain];
      await checkChain(provider, chain);
      const wallet = new Wallet(key.startsWith("0x") ? key : `0x${key}`, provider);
      const factory = new ContractFactory(compiled.abi, compiled.bytecode, wallet);
      const asset = chain === "ethereum" ? existing.mst : ZeroAddress;
      const input = await factory.getDeployTransaction(asset);
      const bytecodeHash = keccak256(input.data);
      let record = manifest.contracts[chain];
      if (record && record.bytecodeHash !== bytecodeHash) throw new Error("Private source changed after deployment; review the recorded version");
      if (!record) {
        const escrow = await factory.deploy(asset);
        const transaction = escrow.deploymentTransaction()!;
        record = { address: await escrow.getAddress(), transactionHash: transaction.hash, bytecodeHash };
        manifest.contracts[chain] = record;
        await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
        console.log(`${chain} private deployment broadcast: ${transaction.hash}`);
      }
      const receipt = await provider.getTransactionReceipt(record.transactionHash)
        ?? await provider.waitForTransaction(record.transactionHash, 1, 60_000);
      if (!receipt) throw new Error("Private deployment still pending; rerun to resume");
      if (receipt.status !== 1 || !receipt.contractAddress || getAddress(receipt.contractAddress) !== getAddress(record.address)) throw new Error("Private deployment failed");
      const transaction = await provider.getTransaction(record.transactionHash);
      if (!transaction || keccak256(transaction.data) !== bytecodeHash || await provider.getCode(record.address) === "0x") throw new Error("Private deployment bytecode mismatch");
      if (getAddress(await new Contract(record.address, compiled.abi, provider).token()) !== getAddress(asset)) throw new Error("Private asset binding mismatch");
      record.blockNumber = receipt.blockNumber;
      await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
      console.log(`${chain} private escrow confirmed: ${record.address}`);
    }
    await writeFile("src/private-config.json", `${JSON.stringify({
      mst: existing.mst, privateMstHtlc: manifest.contracts.ethereum!.address, privateEthHtlc: manifest.contracts.arbitrum!.address,
    }, null, 2)}\n`);
  } finally { Object.values(providers).forEach(p => p.destroy()); }
}
main().catch((error: unknown) => {
  const code = (error as { code?: string }).code;
  console.error(code ? `Private deployment stopped (${code}); recorded broadcasts can be resumed` : error instanceof Error ? error.message : "Private deployment failed");
  process.exitCode = 1;
});
