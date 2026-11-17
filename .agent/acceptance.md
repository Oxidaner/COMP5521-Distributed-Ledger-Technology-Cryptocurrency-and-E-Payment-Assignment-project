# Acceptance evidence

Requirements source: `docs/COMP5521_HTLC_Project_2026.pdf`. Basic A-F scope is 90 marks. Evidence demonstrates implementation, not awarded marks.

| Item | Implemented evidence | Remaining assessment |
| --- | --- | --- |
| A1-A2 | `ERC20HTLC.sol` and `ETHHTLC.sol`; contract tests cover lock records/events, invalid IDs/addresses/amounts/hashlocks/deadlines, duplicate locks and assets held in escrow. | Additional assessor scenarios may use other amounts/accounts. |
| A3-A5 | Receiver-only matching preimage claim; sender-only refund; exact expiry boundary; repeated/cross-state operations rejected. Tests verify transfer failure rollback, SafeERC20 failure and receiver reentry protection. | No external security audit. Configured asset is standard MST. |
| B1 | `docs/evidence/deployment.json`: MST and ERC20 escrow on 11155111, ETH escrow on 421614, confirmed deployment receipts/code. | Recheck RPC/funds before the demonstration. |
| B2 | `testnet-success.json`: 1 MST / 0.0001 ETH, confirmed matching locks, public ETH claim event, MST claim, Claimed/Claimed. Shared verification checks configured escrow/participants/token/amount/hash/deadlines/state. | One receipt confirmation is testnet rehearsal policy, not finality. |
| B3-B4 | Separate providers and block timestamps, local integration with independently advanced clocks, `testnet-recovery.json` early refund rejection plus Refunded/Refunded. | Continue monitoring until completing a live swap or refund. |
| C1-C4 | MetaMask connection/network helpers, balances, public plan/private backup, approval, verified locks/claims/refunds, progress/errors/explorer links. Browser smoke checks exercise responsive layout, no-wallet feedback, live RPC plan generation and actual final-state imports. | Human MetaMask signing rehearsal remains. Mock wallet helper tests do not prove extension dialogs. |
| D | `Report.pdf` uses the four required sections within six pages; `presentation.pptx` has system design, Task A/B, results and limitations, with four-minute notes. | Student review, four-minute oral delivery and Q&A. |
| E | Both real testnet scenarios already executed; `docs/demo.md` prepares a separate four-minute live operation. | Classroom live operation is still required. Prior receipts/screenshots do not earn live-operation marks. |
| F | `docs/contributions.md` and honest `docs/ai-assistance.md`. | Real name/ID and personal work/review evidence remain to be completed. |
| CH1-CH3 | Not selected. | Optional ten marks excluded. |

CI always compiles contracts, runs contract and independent-chain protocol tests, type-checks/builds the UI and checks public evidence/artifact consistency offline. The manual final-acceptance job also rejects missing identity fields. No testnet signing key is used in CI.

`npm run check:acceptance -- --live` independently rechecks public deployment receipts/code, token binding, ten swap receipts and current final states, writing `docs/evidence/live-verification.json`. It is read-only and does not reproduce a fresh swap or verify classroom performance. The early-refund evidence records a read-only rejected call rather than an on-chain failed transaction.
