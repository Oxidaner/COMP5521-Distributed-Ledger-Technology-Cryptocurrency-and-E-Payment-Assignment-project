import { Contract, Interface, ZeroAddress, getAddress, isHexString, toBeHex, type Provider, type Signer } from "ethers";
import { TOKEN_ABI, checkChain, type Chain, type Progress } from "./protocol";
import { derivePrivateClaim, scalarPoint, verifyPrivatePlan, type PrivateConfiguration, type PrivatePlan } from "./privacy";
import { submitTransaction, type TransactionObserver } from "./transactions";

export const PRIVATE_ABI = [
  "function token() view returns (address)",
  "function swaps(bytes32) view returns (address sender,address receiver,uint256 amount,uint256 pointX,uint256 pointY,uint256 timelock,uint8 status)",
  "function createSwap(bytes32,address,uint256,uint256,uint256,uint256) payable",
  "function claim(bytes32,uint256)", "function refund(bytes32)",
  "event SwapCreated(bytes32 indexed swapId,address indexed sender,address indexed receiver,uint256 amount,uint256 pointX,uint256 pointY,uint256 timelock)",
  "event SwapClaimed(bytes32 indexed swapId,uint256 scalar)",
  "event SwapRefunded(bytes32 indexed swapId)",
  ...["InvalidSwap", "InvalidPoint", "InvalidScalar", "Unauthorized", "NotActive", "ClaimExpired", "RefundNotDue", "TransferFailed"].map(name => `error ${name}()`),
];
export interface PrivateState {
  sender: string; receiver: string; amount: string; pointX: string; pointY: string; timelock: number; timestamp: number;
  phase: "Missing" | "Active" | "Expired" | "Claimed" | "Refunded";
}
const addressEqual = (a: string, b: string) => getAddress(a) === getAddress(b);
export const privateLeg = (plan: PrivatePlan, chain: Chain) => chain === "ethereum"
  ? { id: plan.mstSwapId, escrow: plan.privateMstHtlc, sender: plan.alice, receiver: plan.bob, amount: plan.mstAmount, point: plan.mstPoint, deadline: plan.mstTimelock, hash: plan.mstLockTx }
  : { id: plan.ethSwapId, escrow: plan.privateEthHtlc, sender: plan.bob, receiver: plan.alice, amount: plan.ethAmount, point: plan.ethPoint, deadline: plan.ethTimelock, hash: plan.ethLockTx };

export function assertPrivateConfiguration(plan: PrivatePlan, config: PrivateConfiguration): void {
  for (const key of ["mst", "privateMstHtlc", "privateEthHtlc"] as const) {
    if (!addressEqual(plan[key], config[key])) throw new Error("Private plan uses a different configured escrow or token");
  }
}
export async function readPrivateSwap(provider: Provider, plan: PrivatePlan, chain: Chain): Promise<PrivateState> {
  await checkChain(provider, chain);
  const leg = privateLeg(plan, chain);
  const block = await provider.getBlock("latest");
  if (!block) throw new Error("Latest private-swap block unavailable");
  const record = await new Contract(leg.escrow, PRIVATE_ABI, provider).swaps(leg.id, { blockTag: block.number });
  return {
    sender: record.sender, receiver: record.receiver, amount: record.amount.toString(),
    pointX: toBeHex(record.pointX, 32), pointY: toBeHex(record.pointY, 32), timelock: Number(record.timelock), timestamp: block.timestamp,
    phase: record.sender === ZeroAddress ? "Missing" : Number(record.status) === 1 ? "Claimed" : Number(record.status) === 2 ? "Refunded"
      : block.timestamp >= Number(record.timelock) ? "Expired" : "Active",
  };
}
function assertState(plan: PrivatePlan, chain: Chain, state: PrivateState) {
  const leg = privateLeg(plan, chain);
  if (!addressEqual(state.sender, leg.sender) || !addressEqual(state.receiver, leg.receiver) || state.amount !== leg.amount
    || state.pointX.toLowerCase() !== leg.point.x.toLowerCase() || state.pointY.toLowerCase() !== leg.point.y.toLowerCase()
    || state.timelock !== leg.deadline) throw new Error("Private lock does not match the agreed terms");
}
export async function verifyPrivateLock(provider: Provider, config: PrivateConfiguration, plan: PrivatePlan, chain: Chain): Promise<PrivateState> {
  verifyPrivatePlan(plan); assertPrivateConfiguration(plan, config);
  await checkChain(provider, chain);
  const leg = privateLeg(plan, chain);
  const escrow = new Contract(leg.escrow, PRIVATE_ABI, provider);
  if (!addressEqual(await escrow.token(), chain === "ethereum" ? config.mst : ZeroAddress)) throw new Error("Private escrow asset mismatch");
  if (!leg.hash) throw new Error("Confirmed private lock transaction required");
  const receipt = await provider.getTransactionReceipt(leg.hash);
  const iface = new Interface(PRIVATE_ABI);
  if (!receipt || receipt.status !== 1 || !receipt.logs.some(log => {
    if (!addressEqual(log.address, leg.escrow)) return false;
    try { const event = iface.parseLog(log); return event?.name === "SwapCreated" && event.args.swapId.toLowerCase() === leg.id.toLowerCase(); } catch { return false; }
  })) throw new Error("Private lock receipt is unconfirmed or unrelated");
  const state = await readPrivateSwap(provider, plan, chain);
  assertState(plan, chain, state);
  if (state.phase !== "Active") throw new Error("Private lock is not active");
  return state;
}
async function deadline(ethereum: Provider, arbitrum: Provider, plan: PrivatePlan) {
  const blocks = await Promise.all([ethereum.getBlock("latest"), arbitrum.getBlock("latest")]);
  if (blocks.some(block => !block || block.timestamp >= plan.ethTimelock)) throw new Error("Private counter-lock deadline expired");
}

export async function lockPrivateSwap(
  signer: Signer, other: Provider, config: PrivateConfiguration, plan: PrivatePlan, chain: Chain,
  offset = "", progress?: Progress, observe?: TransactionObserver,
): Promise<string> {
  // Bob's secret is checked before allowance, signing, or committing his ETH.
  verifyPrivatePlan(plan, chain === "arbitrum" ? offset : undefined);
  assertPrivateConfiguration(plan, config);
  if (!signer.provider) throw new Error("Signer has no provider");
  await Promise.all([checkChain(signer.provider, chain), checkChain(other, chain === "ethereum" ? "arbitrum" : "ethereum")]);
  const leg = privateLeg(plan, chain);
  if (!addressEqual(await signer.getAddress(), leg.sender)) throw new Error("Connect the private lock sender");
  const ethereum = chain === "ethereum" ? signer.provider : other, arbitrum = chain === "arbitrum" ? signer.provider : other;
  await deadline(ethereum, arbitrum, plan);
  if (chain === "arbitrum") await verifyPrivateLock(other, config, plan, "ethereum");
  const escrow = new Contract(leg.escrow, PRIVATE_ABI, signer);
  if (!addressEqual(await escrow.token(), chain === "ethereum" ? config.mst : ZeroAddress)) throw new Error("Private escrow asset mismatch");
  if (chain === "ethereum") {
    const token = new Contract(config.mst, TOKEN_ABI, signer);
    if (await token.allowance(plan.alice, leg.escrow) < BigInt(leg.amount)) {
      await submitTransaction(() => token.approve(leg.escrow, leg.amount), chain, "private approve", progress, observe);
    }
  }
  await deadline(ethereum, arbitrum, plan);
  return (await submitTransaction(() => escrow.createSwap(leg.id, leg.receiver, leg.amount, leg.point.x, leg.point.y, leg.deadline,
    { value: chain === "arbitrum" ? leg.amount : 0 }), chain, "private lock", progress, observe)).hash;
}

export async function claimPrivateSwap(
  signer: Signer, other: Provider, config: PrivateConfiguration, plan: PrivatePlan, chain: Chain,
  secret: string, progress?: Progress, observe?: TransactionObserver,
): Promise<string> {
  verifyPrivatePlan(plan); assertPrivateConfiguration(plan, config);
  if (!signer.provider) throw new Error("Signer has no provider");
  const leg = privateLeg(plan, chain), actual = scalarPoint(secret);
  if (actual.x.toLowerCase() !== leg.point.x.toLowerCase() || actual.y.toLowerCase() !== leg.point.y.toLowerCase()) throw new Error("Private claim value does not match");
  if (!addressEqual(await signer.getAddress(), leg.receiver)) throw new Error("Connect the private lock receiver");
  await verifyPrivateLock(signer.provider, config, plan, chain);
  if (chain === "arbitrum") await verifyPrivateLock(other, config, plan, "ethereum");
  return (await submitTransaction(() => new Contract(leg.escrow, PRIVATE_ABI, signer).claim(leg.id, secret), chain, "private claim", progress, observe)).hash;
}

export async function observePrivateClaim(provider: Provider, config: PrivateConfiguration, plan: PrivatePlan, hash: string, offset: string): Promise<string> {
  verifyPrivatePlan(plan, offset); assertPrivateConfiguration(plan, config);
  await checkChain(provider, "arbitrum");
  if (!isHexString(hash, 32)) throw new Error("Invalid first private claim transaction");
  const receipt = await provider.getTransactionReceipt(hash);
  if (!receipt || receipt.status !== 1) throw new Error("First private claim is not confirmed");
  const iface = new Interface(PRIVATE_ABI);
  for (const log of receipt.logs) {
    if (!addressEqual(log.address, plan.privateEthHtlc)) continue;
    const event = iface.parseLog(log);
    if (event?.name === "SwapClaimed" && event.args.swapId.toLowerCase() === plan.ethSwapId.toLowerCase())
      return derivePrivateClaim(plan, toBeHex(event.args.scalar, 32), offset);
  }
  throw new Error("No matching first private claim");
}

export async function refundPrivateSwap(signer: Signer, config: PrivateConfiguration, plan: PrivatePlan, chain: Chain, progress?: Progress, observe?: TransactionObserver): Promise<string> {
  verifyPrivatePlan(plan); assertPrivateConfiguration(plan, config);
  if (!signer.provider) throw new Error("Signer has no provider");
  const leg = privateLeg(plan, chain);
  const state = await readPrivateSwap(signer.provider, plan, chain);
  assertState(plan, chain, state);
  if (state.phase !== "Expired") throw new Error("Private refund is available only after expiry");
  if (!addressEqual(await signer.getAddress(), leg.sender)) throw new Error("Connect the private lock sender");
  return (await submitTransaction(() => new Contract(leg.escrow, PRIVATE_ABI, signer).refund(leg.id), chain, "private refund", progress, observe)).hash;
}
