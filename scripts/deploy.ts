import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  Contract, ContractFactory, JsonRpcProvider, NonceManager, Wallet,
  formatEther, getAddress, keccak256, parseUnits,
  type InterfaceAbi, type Signer,
} from "ethers";

type Artifact = { abi: InterfaceAbi; bytecode: string };
type DeploymentRecord = {
  address: string;
  transactionHash: string;
  bytecodeHash: string;
  blockNumber?: number;
};
type Manifest = {
  ethereumSepolia: { chainId: 11155111; mst?: string; erc20Htlc?: string };
  arbitrumSepolia: { chainId: 421614; ethHtlc?: string };
  deployer: string;
  mstInitialSupply: string;
  generatedAt: string;
  contracts: Partial<Record<"MST" | "ERC20HTLC" | "ETHHTLC", DeploymentRecord>>;
};

const manifestPath = join(process.cwd(), "deployments", "testnet.json");

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value || value.includes("YOUR_") || value.includes(".example")) {
    throw new Error(`Missing usable ${name} in .env`);
  }
  return value;
}

function privateKey(): string {
  const configured = process.env.DEPLOYER_PRIVATE_KEY?.trim();
  const value = !configured || configured.includes("YOUR_")
    ? required("ALICE_PRIVATE_KEY") : configured;
  const normalized = value.startsWith("0x") ? value : `0x${value}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(normalized)) throw new Error("Deployment key must be 32 bytes of hexadecimal data");
  return normalized;
}

async function artifact(contract: string): Promise<Artifact> {
  const path = join(process.cwd(), "artifacts", "contracts", `${contract}.sol`, `${contract}.json`);
  return JSON.parse(await readFile(path, "utf8")) as Artifact;
}

async function save(manifest: Manifest): Promise<void> {
  await mkdir(join(process.cwd(), "deployments"), { recursive: true });
  await writeFile(`${manifestPath}.tmp`, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  await rename(`${manifestPath}.tmp`, manifestPath);
}

async function deploy(
  provider: JsonRpcProvider,
  signer: Signer,
  manifest: Manifest,
  name: "MST" | "ERC20HTLC" | "ETHHTLC",
  args: unknown[] = [],
): Promise<string> {
  const compiled = await artifact(name);
  const bytecodeHash = keccak256(compiled.bytecode);
  let record = manifest.contracts[name];
  if (record && record.bytecodeHash !== bytecodeHash) {
    throw new Error(`${name} source differs from the existing deployment; review before deploying a new version`);
  }

  if (!record) {
    const instance = await new ContractFactory(compiled.abi, compiled.bytecode, signer).deploy(...args);
    const transaction = instance.deploymentTransaction();
    if (!transaction) throw new Error(`${name} returned no deployment transaction`);
    record = { address: await instance.getAddress(), transactionHash: transaction.hash, bytecodeHash };
    manifest.contracts[name] = record;
    // Persist the broadcast transaction before waiting, so retries reuse it.
    await save(manifest);
    console.log(`${name} broadcast: ${record.transactionHash}`);
  }

  const receipt = await provider.getTransactionReceipt(record.transactionHash)
    ?? await provider.waitForTransaction(record.transactionHash, 1, 60_000);
  if (!receipt) throw new Error(`${name} is still pending; run npm run deploy again to resume`);
  if (receipt.status !== 1 || await provider.getCode(record.address) === "0x") {
    throw new Error(`${name} deployment failed; inspect its recorded transaction`);
  }
  record.blockNumber = receipt.blockNumber;
  await save(manifest);
  console.log(`${name} confirmed: ${record.address} (block ${receipt.blockNumber})`);
  return record.address;
}

async function main(): Promise<void> {
  const key = privateKey();
  const initialSupply = parseUnits(process.env.MST_INITIAL_SUPPLY ?? "1000000", 18);
  if (initialSupply <= 0n) throw new Error("MST_INITIAL_SUPPLY must be positive");
  const providers = [
    new JsonRpcProvider(required("ETHEREUM_SEPOLIA_RPC_URL")),
    new JsonRpcProvider(required("ARBITRUM_SEPOLIA_RPC_URL")),
  ];
  try {
    const [sepolia, arbitrum] = providers;
    const networks = await Promise.all(providers.map((provider) => provider.getNetwork()));
    if (networks[0].chainId !== 11155111n || networks[1].chainId !== 421614n) {
      throw new Error("Deployment requires Ethereum Sepolia (11155111) and Arbitrum Sepolia (421614)");
    }
    const wallets = providers.map((provider) => new Wallet(key, provider));
    const deployer = wallets[0].address;
    const balances = await Promise.all(providers.map((provider) => provider.getBalance(deployer)));
    console.log(`Deployment account: ${deployer}`);
    console.log(`Balances: Sepolia ${formatEther(balances[0])} ETH; Arbitrum Sepolia ${formatEther(balances[1])} ETH`);
    if (balances.some((balance) => balance === 0n)) throw new Error("Deployment account needs test ETH on both chains");

    let manifest: Manifest;
    try {
      manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Manifest;
      if (getAddress(manifest.deployer) !== deployer || manifest.mstInitialSupply !== initialSupply.toString()) {
        throw new Error("Existing deployment account or initial supply differs; review deployments/testnet.json");
      }
      if (!manifest.contracts) throw new Error("Existing deployment has no transaction records; review it before continuing");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      manifest = {
        ethereumSepolia: { chainId: 11155111 }, arbitrumSepolia: { chainId: 421614 },
        deployer, mstInitialSupply: initialSupply.toString(), generatedAt: new Date().toISOString(), contracts: {},
      };
    }

    const [sepoliaSigner, arbitrumSigner] = wallets.map((wallet) => new NonceManager(wallet));
    manifest.ethereumSepolia.mst = await deploy(sepolia, sepoliaSigner, manifest, "MST", [initialSupply]);
    await save(manifest);
    manifest.ethereumSepolia.erc20Htlc = await deploy(sepolia, sepoliaSigner, manifest, "ERC20HTLC", [manifest.ethereumSepolia.mst]);
    const escrow = new Contract(manifest.ethereumSepolia.erc20Htlc, ["function token() view returns (address)"], sepolia);
    if (await escrow.token() !== manifest.ethereumSepolia.mst) throw new Error("ERC20HTLC token verification failed");
    await save(manifest);
    manifest.arbitrumSepolia.ethHtlc = await deploy(arbitrum, arbitrumSigner, manifest, "ETHHTLC");
    await save(manifest);
    console.log("Verified all three deployments; public addresses saved to deployments/testnet.json");
  } finally {
    providers.forEach((provider) => provider.destroy());
  }
}

main().catch((error: unknown) => {
  const code = (error as { code?: string }).code;
  console.error(code ? `Deployment stopped (${code}); transaction progress remains in deployments/testnet.json` : error instanceof Error ? error.message : "Deployment failed");
  process.exitCode = 1;
});
