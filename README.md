# COMP5521 2026 Cross-chain HTLC

Working basic A-F implementation: MST on Ethereum Sepolia is exchanged for native ETH on Arbitrum Sepolia. Hardhat 3, TypeScript, ethers 6 and React/Vite share one pinned npm toolchain. The two contracts never call each other. The optional privacy challenge is not selected (basic maximum: 90/100).

## Verified deployment

| Asset / contract | Chain ID | Address |
| --- | --- | --- |
| MST (18 decimals) | 11155111 | `0xF84f6b13121161b9e8351D407AE30b160d22A611` |
| ERC20HTLC | 11155111 | `0xd3CBcA8CA30513945D3e8ae8190634432e3F8f47` |
| ETHHTLC | 421614 | `0x220202AAc9C7f75cCfeA5780C62b06B71fbaAA71` |

Deployment receipts: [public manifest](docs/evidence/deployment.json). Both required testnet paths ran on 17 November 2026, exchanging 1 MST for 0.0001 ETH:

- [Success evidence](docs/evidence/testnet-success.json): confirmed locks, ETH claim revealing the preimage, MST claim, independent final states `Claimed / Claimed`.
- [Recovery evidence](docs/evidence/testnet-recovery.json): early refund rejected with `RefundNotDue` by a read-only contract call, followed by confirmed refunds and `Refunded / Refunded`.
- View Ethereum transactions at `https://sepolia.etherscan.io/tx/<hash>` and Arbitrum transactions at `https://sepolia.arbiscan.io/tx/<hash>`.

## Install and verify

Use Node 24.14 or later within Node 24.

```bash
npm ci
npm test
npm run build:web
npm run check:acceptance
npm run dev
```

Open `http://127.0.0.1:5173`. Nine contract tests cover successful transfers, validation, authorization, expiry boundaries, repeated completion, transfer failure rollback and receiver reentry. Ten protocol tests include two separate simulated chains completing success and recovery, strict import validation, plan/secret merging and first-lock expiry checks before and after approval; chain clocks advance independently. `npm run demo:local` runs the protocol tests without keys or test ETH.

`npm run check:acceptance` checks artifact/evidence consistency offline. Add `-- --live` to query the public testnets read-only and verify deployment code, transaction receipts and final states. Add `-- --submission` to require completed identity fields. CI never needs signing credentials. A passing check does not prove classroom performance or student contribution.

## Configuration and deployment

Copy `.env.example` to `.env` locally and set RPC URLs, Alice/Bob addresses and test-only keys. Alice and Bob need test ETH on both networks for gas. Alice needs MST for locking. If a separate deployment signer receives the initial MST supply, transfer MST to Alice before running a swap. The current deployment used Alice as deployer.

```bash
npm run compile
npm run deploy
```

Deployment validates chain IDs, waits for successful receipts and deployed code, and records progress in ignored `deployments/testnet.json`. Copy the manifest's MST and HTLC addresses into the corresponding local `.env` fields for protocol commands. Repeating deployment resumes verified contracts instead of creating duplicates. A fresh installation can configure the published addresses directly to operate the existing contracts; running deployment without a local manifest creates new contracts.

Update `src/public-config.json` when selecting a different deployment. This file contains public contract addresses and keyless public RPC URLs. The browser signs through MetaMask and never loads `.env` or script signing keys. `.env.example` contains placeholders only.

## Browser exchange

1. Connect Alice in MetaMask. Enter Alice and Bob addresses, 1 MST and 0.0001 ETH. Generate a plan and save the private backup before locking. Default deadlines are ETH 600s / MST 1200s. The demo checkbox uses 90s / 180s, which requires prompt operation.
2. Alice approves and locks MST on Ethereum Sepolia. Share the public plan after the confirmed MST lock so it includes `mstLockTx`.
3. Switch to Bob. Import the plan if using another browser, independently verify MST, and create the matching ETH lock on Arbitrum Sepolia. Share the updated public plan with Alice if using separate browsers.
4. Switch to Alice, retaining/importing her private preimage. Verify and claim ETH before expiry. The confirmed claim reveals the preimage publicly.
5. Switch to Bob. Enter Alice's confirmed ETH claim hash and observe the secret to claim MST. Refresh both chains to see `Claimed / Claimed`.
6. For recovery, create a separate swap, leave it unclaimed, show refund unavailable before expiry, then let Bob refund ETH and Alice refund MST after their respective chain deadlines. Both states become `Refunded`.

The private backup contains the secret and must stay private until the ETH claim. Public plans contain only agreed parameters and lock hashes. Importing an updated plan for the same swap preserves a matching private secret; importing an older private backup preserves known lock hashes. Changes to the agreed parameters under the same swap ID are rejected. Page reload clears the active in-memory plan, so save updated backups/plans. State and balances refresh independently for each chain; an unavailable RPC is reported on that chain without blocking refunds on the other. Expired plans cannot start new locks, and the first lock rechecks both chain timestamps after approval. See [the timed live runbook](docs/demo.md).

## Script exchange and recovery

After local deployment/configuration:

```bash
npm run protocol -- success
npm run protocol -- recovery
npm run protocol -- create
npm run protocol -- inspect <SWAP_ID>
npm run protocol -- claim <SWAP_ID> arbitrum
npm run protocol -- claim <SWAP_ID> ethereum
npm run protocol -- refund <SWAP_ID> arbitrum
npm run protocol -- refund <SWAP_ID> ethereum
```

`create` generates a new secret and locks both sides without claiming. `success` also completes both claims. `recovery` uses ETH 45s / MST 90s, checks early refund rejection, waits on each chain's timestamp and refunds. Never rerun a transaction blindly after an interruption: inspect the saved job and current chain states first. A confirmed-transaction progress callback saves local recovery records, but interruption between broadcast and confirmation can require manual transaction inspection.

Script recovery records in `deployments/swaps/` contain private preimages. They are ignored and excluded from the submission. Each completed rehearsal updates sanitized `docs/evidence/testnet-*.json`; successful preimages already appear in chain events but are omitted from these files. Scripts require both local role keys even for inspection in this version. `MST_SWAP_AMOUNT` and `ETH_SWAP_AMOUNT` can override the CLI's 1 / 0.0001 defaults. Default successful deadlines use the duration values in `.env`; the recovery command deliberately uses its short rehearsal values.

## Deliverables and remaining assessment

- [Report.pdf](Report.pdf): four required sections, at most six pages including its references and contribution appendix.
- [presentation.pptx](presentation.pptx): editable slides with four-minute speaker notes.
- [Contribution table](docs/contributions.md): real name, student ID and student-reviewed contributions still need completion. [AI assistance](docs/ai-assistance.md) records actual generated work.
- [Acceptance map](.agent/acceptance.md), [design](docs/architecture.md), [changes from Lab 4](Changes.md), [live demo](docs/demo.md).
- `npm run package:submission` creates `submission/COMP5521_HTLC_GroupXX.zip` from an allowlist. Fill identity fields, replace GroupXX with the assigned identifier and regenerate before upload. The strict manual CI gate fails while identity fields remain TBD.

The automated browser checks cover loading, responsive layout, missing-wallet feedback, public RPC plan generation and importing actual final-state evidence. Actual MetaMask transaction signing still needs a human rehearsal. Task E requires a real four-minute live operation, and Task D includes a four-minute presentation plus two minutes Q&A. Existing transactions and prepared materials do not complete those assessments.

Presentation: 27 November 2026, 18:30-21:30, FJ303. Canvas upload: before 4 December 2026, 23:59. Source: [project specification](docs/COMP5521_HTLC_Project_2026.pdf).
