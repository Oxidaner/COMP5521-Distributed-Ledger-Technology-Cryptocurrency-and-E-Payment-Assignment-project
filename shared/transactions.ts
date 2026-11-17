import type { TransactionReceipt } from "ethers";
import type { Chain, Progress } from "./protocol";

export type TransactionUpdate =
  | { chain: Chain; action: string; stage: "signature" }
  | { chain: Chain; action: string; stage: "pending"; hash: string }
  | { chain: Chain; action: string; stage: "attention"; hash: string }
  | { chain: Chain; action: string; stage: "confirmed"; hash: string; blockNumber: number };
export type TransactionObserver = (update: TransactionUpdate) => void | Promise<void>;

export async function submitTransaction(
  send: () => Promise<{ hash: string; wait(): Promise<TransactionReceipt | null> }>,
  chain: Chain, action: string, progress?: Progress, observe?: TransactionObserver,
): Promise<TransactionReceipt> {
  await observe?.({ chain, action, stage: "signature" });
  const transaction = await send();
  await observe?.({ chain, action, stage: "pending", hash: transaction.hash });
  let receipt: TransactionReceipt | null;
  try {
    receipt = await transaction.wait();
    if (!receipt || receipt.status !== 1) throw new Error(`${action} transaction failed`);
  } catch (error) {
    await observe?.({ chain, action, stage: "attention", hash: transaction.hash });
    throw error;
  }
  await observe?.({ chain, action, stage: "confirmed", hash: receipt.hash, blockNumber: receipt.blockNumber });
  await progress?.({ chain, hash: receipt.hash, blockNumber: receipt.blockNumber, action });
  return receipt;
}
