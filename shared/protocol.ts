import {
  Contract, Interface, ZeroAddress, getAddress, hexlify, isHexString, keccak256,
  parseEther, randomBytes, type Provider, type Signer, type TransactionReceipt,
} from "ethers";

export const TOKEN_ABI = [
  "function approve(address,uint256) returns (bool)",
  "function transfer(address,uint256) returns (bool)",
  "function allowance(address,address) view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
  "function totalSupply() view returns (uint256)",
];
export const COMMON_ABI = [
  "function swaps(bytes32) view returns (address sender,address receiver,address token,uint256 amount,bytes32 hashlock,uint256 timelock,uint8 status)",
  "function claim(bytes32,bytes32)", "function refund(bytes32)",
  "event SwapCreated(bytes32 indexed swapId,address indexed sender,address indexed receiver,address token,uint256 amount,bytes32 hashlock,uint256 timelock)",
  "event SwapClaimed(bytes32 indexed swapId,bytes32 preimage)",
  "event SwapRefunded(bytes32 indexed swapId)",
  ...["InvalidSwapId", "InvalidReceiver", "InvalidAmount", "InvalidHashlock", "InvalidTimelock", "SwapAlreadyExists", "SwapNotFound", "Unauthorized", "NotActive", "ClaimExpired", "RefundNotDue", "InvalidPreimage", "TransferFailed"].map((name) => `error ${name}()`),
];
export const MST_ABI = [...COMMON_ABI, "function token() view returns (address)", "function createSwap(bytes32,address,uint256,bytes32,uint256)"];
export const ETH_ABI = [...COMMON_ABI, "function createSwap(bytes32,address,bytes32,uint256) payable"];

export type Chain = "ethereum" | "arbitrum";
export interface Configuration { mst: string; erc20Htlc: string; ethHtlc: string }
export interface SwapPlan {
  swapId: string; hashlock: string; alice: string; bob: string;
  mstAmount: string; ethAmount: string; mstTimelock: number; ethTimelock: number;
  mstLockTx?: string; ethLockTx?: string;
}
export interface SwapState {
  sender: string; receiver: string; token: string; amount: string;
  hashlock: string; timelock: number; status: number; timestamp: number;
  phase: "Missing" | "Active" | "Expired" | "Claimed" | "Refunded";
}
export interface ReceiptEvidence { chain: Chain; hash: string; blockNumber: number; action: string }
export type Progress = (evidence: ReceiptEvidence) => void | Promise<void>;

export const chainIds = { ethereum: 11155111n, arbitrum: 421614n };
export const explorers = { ethereum: "https://sepolia.etherscan.io", arbitrum: "https://sepolia.arbiscan.io" };
const sameAddress = (a: string, b: string) => getAddress(a) === getAddress(b);

export function validatePlan(plan: SwapPlan): void {
  if (!isHexString(plan.swapId, 32) || /^0x0+$/.test(plan.swapId)) throw new Error("Invalid swap ID");
  if (!isHexString(plan.hashlock, 32) || /^0x0+$/.test(plan.hashlock)) throw new Error("Invalid hashlock");
  if (sameAddress(plan.alice, ZeroAddress) || sameAddress(plan.bob, ZeroAddress) || sameAddress(plan.alice, plan.bob)) throw new Error("Alice and Bob must be distinct nonzero addresses");
  if (BigInt(plan.mstAmount) <= 0n || BigInt(plan.ethAmount) <= 0n) throw new Error("Amounts must be positive");
  if (![plan.ethTimelock, plan.mstTimelock].every((v) => Number.isSafeInteger(v) && v > 0)) throw new Error("Invalid timelocks");
  if (plan.mstTimelock <= plan.ethTimelock) throw new Error("MST deadline must be later than ETH deadline");
}

export function createPlan(alice: string, bob: string, timestamp: number, mst = "10", eth = "0.001", ethDuration = 600, mstDuration = 1200): { plan: SwapPlan; preimage: string } {
  const preimage = hexlify(randomBytes(32));
  const plan: SwapPlan = {
    swapId: hexlify(randomBytes(32)), hashlock: keccak256(preimage),
    alice: getAddress(alice), bob: getAddress(bob), mstAmount: parseEther(mst).toString(), ethAmount: parseEther(eth).toString(),
    mstTimelock: timestamp + mstDuration, ethTimelock: timestamp + ethDuration,
  };
  validatePlan(plan);
  return { plan, preimage };
}

export async function checkChain(provider: Provider, chain: Chain): Promise<void> {
  if ((await provider.getNetwork()).chainId !== chainIds[chain]) throw new Error(`Wrong ${chain} network`);
}

export async function readSwap(provider: Provider, address: string, swapId: string): Promise<SwapState> {
  const block = await provider.getBlock("latest");
  if (!block) throw new Error("Latest block unavailable");
  const record = await new Contract(address, COMMON_ABI, provider).swaps(swapId, { blockTag: block.number });
  const status = Number(record.status);
  const timelock = Number(record.timelock);
  const phase = record.sender === ZeroAddress ? "Missing" : status === 1 ? "Claimed" : status === 2 ? "Refunded" : block.timestamp >= timelock ? "Expired" : "Active";
  return { sender: record.sender, receiver: record.receiver, token: record.token, amount: record.amount.toString(), hashlock: record.hashlock, timelock, status, timestamp: block.timestamp, phase };
}

export function assertLock(state: SwapState, plan: SwapPlan, config: Configuration, chain: Chain, requireActive = true): void {
  validatePlan(plan);
  const mst = chain === "ethereum";
  const fieldsMatch = sameAddress(state.sender, mst ? plan.alice : plan.bob)
    && sameAddress(state.receiver, mst ? plan.bob : plan.alice)
    && sameAddress(state.token, mst ? config.mst : ZeroAddress)
    && state.amount === (mst ? plan.mstAmount : plan.ethAmount)
    && state.hashlock.toLowerCase() === plan.hashlock.toLowerCase()
    && state.timelock === (mst ? plan.mstTimelock : plan.ethTimelock);
  if (!fieldsMatch) throw new Error(`${chain} lock parameters do not match the agreed plan`);
  if (requireActive && state.phase !== "Active") throw new Error(`${chain} lock is not active`);
}

export async function verifyLock(provider: Provider, config: Configuration, plan: SwapPlan, chain: Chain): Promise<SwapState> {
  await checkChain(provider, chain);
  const address = chain === "ethereum" ? config.erc20Htlc : config.ethHtlc;
  const txHash = chain === "ethereum" ? plan.mstLockTx : plan.ethLockTx;
  if (!txHash) throw new Error(`${chain} confirmed lock transaction is required`);
  const receipt = await provider.getTransactionReceipt(txHash);
  if (!receipt || receipt.status !== 1) throw new Error(`${chain} lock transaction is unconfirmed or failed`);
  const iface = new Interface(COMMON_ABI);
  const created = receipt.logs.some((log) => {
    if (!sameAddress(log.address, address)) return false;
    try { const event = iface.parseLog(log); return event?.name === "SwapCreated" && event.args.swapId === plan.swapId; }
    catch { return false; }
  });
  if (!created) throw new Error(`${chain} transaction does not create this swap at the configured escrow`);
  const state = await readSwap(provider, address, plan.swapId);
  assertLock(state, plan, config, chain);
  return state;
}

async function confirm(tx: { hash: string; wait(): Promise<TransactionReceipt | null> }, chain: Chain, action: string, progress?: Progress): Promise<TransactionReceipt> {
  const receipt = await tx.wait();
  if (!receipt || receipt.status !== 1) throw new Error(`${action} transaction failed`);
  await progress?.({ chain, hash: receipt.hash, blockNumber: receipt.blockNumber, action });
  return receipt;
}

export async function lockMst(signer: Signer, config: Configuration, plan: SwapPlan, progress?: Progress): Promise<string> {
  validatePlan(plan);
  if (!signer.provider) throw new Error("Signer has no provider");
  await checkChain(signer.provider, "ethereum");
  if (!sameAddress(await signer.getAddress(), plan.alice)) throw new Error("Connect Alice to lock MST");
  const escrow = new Contract(config.erc20Htlc, MST_ABI, signer);
  if (!sameAddress(await escrow.token(), config.mst)) throw new Error("Escrow MST address mismatch");
  const token = new Contract(config.mst, TOKEN_ABI, signer);
  if (await token.allowance(plan.alice, config.erc20Htlc) < BigInt(plan.mstAmount)) {
    await confirm(await token.approve(config.erc20Htlc, plan.mstAmount), "ethereum", "approve", progress);
  }
  return (await confirm(await escrow.createSwap(plan.swapId, plan.bob, plan.mstAmount, plan.hashlock, plan.mstTimelock), "ethereum", "lock", progress)).hash;
}

export async function lockEth(signer: Signer, ethereum: Provider, config: Configuration, plan: SwapPlan, progress?: Progress): Promise<string> {
  if (!signer.provider) throw new Error("Signer has no provider");
  await checkChain(signer.provider, "arbitrum");
  if (!sameAddress(await signer.getAddress(), plan.bob)) throw new Error("Connect Bob to lock ETH");
  const mst = await verifyLock(ethereum, config, plan, "ethereum");
  const ethBlock = await signer.provider.getBlock("latest");
  if (!ethBlock || plan.ethTimelock <= ethBlock.timestamp || plan.ethTimelock <= mst.timestamp) throw new Error("ETH deadline has expired; prepare a new plan");
  const escrow = new Contract(config.ethHtlc, ETH_ABI, signer);
  return (await confirm(await escrow.createSwap(plan.swapId, plan.alice, plan.hashlock, plan.ethTimelock, { value: plan.ethAmount }), "arbitrum", "lock", progress)).hash;
}

export async function claimSwap(signer: Signer, other: Provider, config: Configuration, plan: SwapPlan, chain: Chain, preimage: string, progress?: Progress): Promise<string> {
  if (!signer.provider) throw new Error("Signer has no provider");
  if (!isHexString(preimage, 32) || keccak256(preimage) !== plan.hashlock) throw new Error("Wrong preimage");
  const state = await verifyLock(signer.provider, config, plan, chain);
  if (!sameAddress(await signer.getAddress(), state.receiver)) throw new Error("Only the receiver can claim");
  if (chain === "arbitrum") await verifyLock(other, config, plan, "ethereum");
  const address = chain === "ethereum" ? config.erc20Htlc : config.ethHtlc;
  return (await confirm(await new Contract(address, COMMON_ABI, signer).claim(plan.swapId, preimage), chain, "claim", progress)).hash;
}

export async function refundSwap(signer: Signer, config: Configuration, plan: SwapPlan, chain: Chain, progress?: Progress): Promise<string> {
  if (!signer.provider) throw new Error("Signer has no provider");
  await checkChain(signer.provider, chain);
  const address = chain === "ethereum" ? config.erc20Htlc : config.ethHtlc;
  const state = await readSwap(signer.provider, address, plan.swapId);
  assertLock(state, plan, config, chain, false);
  if (state.phase !== "Expired") throw new Error("Refund is available only for an expired active lock");
  if (!sameAddress(await signer.getAddress(), state.sender)) throw new Error("Only the sender can refund");
  return (await confirm(await new Contract(address, COMMON_ABI, signer).refund(plan.swapId), chain, "refund", progress)).hash;
}

export async function revealedPreimage(provider: Provider, config: Configuration, plan: SwapPlan, claimTx: string): Promise<string> {
  await checkChain(provider, "arbitrum");
  const receipt = await provider.getTransactionReceipt(claimTx);
  if (!receipt || receipt.status !== 1) throw new Error("ETH claim transaction is not confirmed");
  const iface = new Interface(COMMON_ABI);
  for (const log of receipt.logs) {
    if (!sameAddress(log.address, config.ethHtlc)) continue;
    try {
      const event = iface.parseLog(log);
      if (event?.name === "SwapClaimed" && event.args.swapId === plan.swapId && keccak256(event.args.preimage) === plan.hashlock) return event.args.preimage;
    } catch { /* Ignore unrelated logs. */ }
  }
  throw new Error("No matching preimage was revealed by this transaction");
}
