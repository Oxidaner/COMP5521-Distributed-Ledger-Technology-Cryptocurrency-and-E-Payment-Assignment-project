# Acceptance map for agents and reviewers

Source of truth: `docs/COMP5521_HTLC_Project_2026.pdf`. Use this as a
checklist, not as a claim that a successful CI run proves a live swap.
Mark each row with a test, public transaction link or report/demo evidence
when it exists. All rows are currently pending.

| Item | Verification required | Evidence |
| --- | --- | --- |
| A1-A2 | Unique valid MST and ETH locks, correct escrow values, records and creation events; invalid/duplicate/zero-value cases | Pending |
| A3-A5 | Receiver-only preimage claim before expiry; sender-only refund after expiry; no repeat/late/cross-state completion; transfer and reentrancy safety | Pending |
| B1 | Deploy to Ethereum Sepolia (11155111) and Arbitrum Sepolia (421614); record MST/HTLC addresses without private keys | Pending |
| B2 | Generate secret/hash, confirm and verify the first lock before the second; claim ETH then MST; show both confirmed tx hashes and final states | Pending |
| B3-B4 | Query each chain independently; show active/claimable/claimed/expired/refundable states; recover expired locks and suppress invalid actions | Pending |
| C1-C4 | Wallet/network switch, balances, approval, lock/verify/counter-lock/claim/refund guidance, progress/errors/links/final states | Pending |
| D | Report at most six main-text pages: design/implementation, Task A/B mechanisms, tests/results and limitations; slides and explainable functions | Pending |
| E | Four-minute live success plus timeout or failure/recovery; invalid action before expiry and refund after expiry | Pending |
| F | Five real names/IDs, owned work and verifiable individual evidence; all available for Q&A | Pending |
| CH1-CH3 | Optional only: distinct public unlocking values, verifiable private linkage, atomicity/privacy analysis and failed-proof case | Not selected |

Automated PR CI checks local compile, contract/protocol tests and browser
build once implementation starts. It cannot prove testnet deployment,
timelock waits, MetaMask interaction, the timed live demo, report quality
or genuine individual authorship. A manual final-acceptance CI run checks
required file presence, while reviewers attach the remaining evidence.

Expected negative tests: duplicate/invalid swap ID, zero token/ETH amount,
bad addresses/deadlines, wrong receiver, wrong preimage, early refund,
late claim, repeated claim/refund and refund after claim. Protocol tests
must include mismatched counter-lock parameters, unconfirmed transactions,
both-chain independent status and timeout recovery. Run real testnet
checks with locally held credentials, never in a public PR workflow.
