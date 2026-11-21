import type { Provider, TransactionReceipt } from "ethers";

// AI-assisted: retry only missing receipts; never resend transactions or hide RPC errors.
export async function getReceiptWithRetry(
  provider: Pick<Provider, "getTransactionReceipt">,
  hash: string,
  options: { attempts?: number; delayMs?: number } = {},
): Promise<TransactionReceipt | null> {
  const { attempts = 3, delayMs = 2000 } = options;
  if (!Number.isSafeInteger(attempts) || attempts < 1 || !Number.isFinite(delayMs) || delayMs < 0) {
    throw new Error("Invalid receipt retry options");
  }
  for (let attempt = 0; attempt < attempts; attempt++) {
    const receipt = await provider.getTransactionReceipt(hash);
    // A reverted transaction is a real receipt: return it for caller validation immediately.
    if (receipt !== null) return receipt;
    if (attempt + 1 < attempts) await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
  }
  return null;
}
