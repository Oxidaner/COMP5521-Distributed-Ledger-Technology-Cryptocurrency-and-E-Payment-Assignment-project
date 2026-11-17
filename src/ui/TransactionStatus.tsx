import { explorers, type ReceiptEvidence } from "../../shared/protocol";
import type { TransactionUpdate } from "../../shared/transactions";

export function TransactionStatus({ pending, confirmed }: { pending: TransactionUpdate | null; confirmed: ReceiptEvidence[] }) {
  return <>
    {pending?.stage === "signature" && <p role="status">Waiting for wallet signature: {pending.action} on {pending.chain}.</p>}
    {pending?.stage === "pending" && <p role="status">Broadcast; waiting for confirmation: <a href={`${explorers[pending.chain]}/tx/${pending.hash}`} target="_blank" rel="noreferrer">{pending.hash}</a></p>}
    {pending?.stage === "attention" && <p role="status">Confirmation failed or unavailable. Inspect the transaction before retrying: <a href={`${explorers[pending.chain]}/tx/${pending.hash}`} target="_blank" rel="noreferrer">{pending.hash}</a></p>}
    {confirmed.length > 0 && <ol className="transaction-list">{confirmed.map(tx => <li key={tx.hash}>{tx.chain} / {tx.action}: <a href={`${explorers[tx.chain]}/tx/${tx.hash}`} target="_blank" rel="noreferrer">{tx.hash}</a> · block {tx.blockNumber}</li>)}</ol>}
  </>;
}
