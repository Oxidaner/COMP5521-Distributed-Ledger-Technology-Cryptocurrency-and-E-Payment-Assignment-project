import { explorers, type ReceiptEvidence } from "../../shared/protocol";
import type { TransactionUpdate } from "../../shared/transactions";

export function TransactionStatus({ pending, confirmed }: { pending: TransactionUpdate | null; confirmed: ReceiptEvidence[] }) {
  if (!pending && confirmed.length === 0) return null;
  return <div className="tx-feed">
    {pending?.stage === "signature" && <p className="tx-pending" role="status"><span className="spinner" aria-hidden="true" /><span>Waiting for wallet signature: {pending.action} on {pending.chain}.</span></p>}
    {pending?.stage === "pending" && <p className="tx-pending" role="status"><span className="spinner" aria-hidden="true" /><span>Broadcast; waiting for confirmation: <a href={`${explorers[pending.chain]}/tx/${pending.hash}`} target="_blank" rel="noreferrer">{pending.hash}</a></span></p>}
    {pending?.stage === "attention" && <p className="tx-pending attention" role="status"><span className="attention-mark" aria-hidden="true">!</span><span>Confirmation failed or unavailable. Inspect the transaction before retrying: <a href={`${explorers[pending.chain]}/tx/${pending.hash}`} target="_blank" rel="noreferrer">{pending.hash}</a></span></p>}
    {confirmed.length > 0 && <ol className="transaction-list" aria-label="Confirmed transactions">
      {confirmed.map(tx => <li key={tx.hash}>
        <span className={`chain-tag ${tx.chain}`}>{tx.chain}</span>
        <span className="tx-body">
          <strong>{tx.action}</strong>
          <a href={`${explorers[tx.chain]}/tx/${tx.hash}`} target="_blank" rel="noreferrer">{tx.hash}</a>
        </span>
        <span className="tx-block">block {tx.blockNumber}</span>
      </li>)}
    </ol>}
  </div>;
}
