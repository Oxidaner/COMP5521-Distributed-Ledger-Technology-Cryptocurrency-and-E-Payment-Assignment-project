import assert from "node:assert/strict";
import { test } from "node:test";
import type { TransactionReceipt } from "ethers";
import { getReceiptWithRetry } from "../shared/receipts.ts";

// AI-assisted regression coverage for read-only receipt retries.
const hash = `0x${"12".repeat(32)}`;
for (const status of [1, 0]) {
  test(`returns an existing receipt with status ${status} without retrying`, async () => {
    let calls = 0;
    const receipt = { status } as TransactionReceipt;
    const result = await getReceiptWithRetry({ getTransactionReceipt: async () => { calls++; return receipt; } }, hash, { delayMs: 0 });
    assert.equal(result, receipt);
    assert.equal(calls, 1);
  });
}
test("retries a missing receipt and stops as soon as it is available", async () => {
  let calls = 0;
  const receipt = { status: 1 } as TransactionReceipt;
  const result = await getReceiptWithRetry({ getTransactionReceipt: async (requested) => {
    assert.equal(requested, hash);
    return ++calls < 3 ? null : receipt;
  } }, hash, { delayMs: 0 });
  assert.equal(result, receipt);
  assert.equal(calls, 3);
});
test("stops after three missing receipts without claiming success", async () => {
  let calls = 0;
  assert.equal(await getReceiptWithRetry({ getTransactionReceipt: async () => { calls++; return null; } }, hash, { delayMs: 0 }), null);
  assert.equal(calls, 3);
});
test("propagates RPC errors immediately", async () => {
  let calls = 0;
  const error = new Error("RPC unavailable");
  await assert.rejects(() => getReceiptWithRetry({ getTransactionReceipt: async () => { calls++; throw error; } }, hash, { delayMs: 0 }), error);
  assert.equal(calls, 1);
});
test("rejects invalid retry options before contacting RPC", async () => {
  const provider = { getTransactionReceipt: async () => { throw new Error("Must not query"); } };
  for (const options of [{ attempts: 0 }, { attempts: 1.5 }, { delayMs: -1 }]) {
    await assert.rejects(() => getReceiptWithRetry(provider, hash, options), /Invalid receipt retry options/);
  }
});
