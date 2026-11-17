# Live demonstration runbook

The assessment has separate slots: four minutes slides, four minutes live operation, two minutes Q&A. Use the deployed contracts and funded accounts before the slot. No video replaces live operation.

## Preparation

- Run `npm test`, `npm run build:web` and `npm run check:acceptance -- --live` ahead of the slot. Open `npm run dev` at `http://127.0.0.1:5173` with MetaMask.
- Check Alice's MST and both accounts' gas balances on both chains. Select the published contracts. Keep recovery JSON backups private.
- Rehearse network/account switching. A single browser preserves the current plan while switching Alice/Bob. Two browsers require sharing updated public plans after each lock.
- Default UI deadlines (600s/1200s) suit ordinary use. Demo deadlines (90s/180s) are short and only suitable for a prompt rehearsal. Testnet inclusion and wallet dialogs can take longer than expected. Prepare a fresh plan if a deadline expires before counter-locking.
- Open explorer tabs and terminal beside the browser. Deployment is outside the four-minute slot. Do not count historical evidence as a fresh live swap.

## Four-minute live sequence

| Time budget | Live action | Evidence to point out |
| --- | --- | --- |
| 0:00-0:20 | Connect Alice and show both balances, addresses and chain IDs. Generate a success plan using normal deadlines and save the secret. | Shared hashlock, participants, amount and ordered deadlines. |
| 0:20-1:00 | Alice approves/locks MST. Switch Bob, independently verify MST, then lock ETH. | Confirmed transaction links and matching parameters on separate chains. |
| 1:00-1:40 | Switch Alice to claim ETH. Switch Bob and use the confirmed ETH claim hash to recover the public preimage and claim MST. | Both claims and independent Claimed/Claimed states. |
| 1:40-2:20 | Start a separate recovery instance with short demo deadlines. Alice locks MST, Bob verifies/locks ETH. Show refund disabled before expiry. | Invalid/unavailable early action and each chain's current timestamp. |
| 2:20-4:00 | Wait for ETH expiry and refund as Bob, then MST expiry and refund as Alice. | New confirmed refunds and Refunded/Refunded. |

The 180s MST recovery deadline starts at plan generation, so a strictly sequential browser recovery started at 1:40 can exceed four minutes. To fit the slot, start the recovery instance near the beginning in a second browser context/terminal and overlap its waiting period with the success demonstration. The PDF explicitly permits separate swap instances and shortened deadlines. Rehearse this timing with current network latency.

For a more predictable live terminal recovery, run `npm run protocol -- recovery` near 0:00 in a second terminal. It uses ETH 45s / MST 90s, prints the early `RefundNotDue` rejection from a static call, waits on real chain time, and sends the two refunds. Keep the browser as the main interface for the success workflow and inspect the terminal recovery's final state/evidence in the browser after completion. CLI automation uses local test keys, while the browser uses MetaMask. RPC congestion can still overrun the slot.

## Commands and recovery after interruption

```bash
npm run protocol -- success
npm run protocol -- recovery
npm run protocol -- inspect <SWAP_ID>
npm run protocol -- refund <SWAP_ID> arbitrum
npm run protocol -- refund <SWAP_ID> ethereum
```

Inspect before retrying any write. If ETH was claimed, Bob should retrieve the confirmed claim's preimage and claim MST before the longer deadline. If neither side was claimed, refund after the relevant expiry. A failure after transaction broadcast may require locating its hash in the wallet/explorer before retrying.

## Q&A preparation

- Why does MST have the longer deadline? Bob needs time to observe Alice's ETH claim and submit his MST claim.
- What links the chains? The same public hashlock and the secret revealed by the first claim. Neither contract reads the other chain.
- Can an observer steal after seeing the preimage? Claim also requires the designated receiver address.
- What happens at exact expiry? Claim fails at `timestamp >= deadline`; the original sender can refund then if still active.
- How is the counter-lock verified? Confirmed creation receipt at the configured contract, plus independent reads of sender, receiver, token, amount, hashlock, deadline and active state.
- What remains risky? One confirmation can reorganize, short deadlines can race, lost secrets/browser state need backups, and a missed claim deadline can break fairness. Participants must stay online and act in time.
- What is public? Addresses, amounts, timing, matching hashes and the revealed preimage. No optional privacy mechanism is claimed.
