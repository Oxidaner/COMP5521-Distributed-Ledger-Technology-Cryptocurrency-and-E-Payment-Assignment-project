# Five-person workspace

Replace Member 1-5 with names in `docs/contributions.md`. Each person owns
code or testable analysis as well as review and presentation duties.

| Person | Primary deliverable | Acceptance evidence | Review handoff |
| --- | --- | --- | --- |
| Member 1 | `ERC20HTLC.sol`, MST approval/escrow contract tests (A1, A3-A5) | Invalid/duplicate lock, claim and refund test results | Reviews Member 2's transfer/state safety |
| Member 2 | `ETHHTLC.sol`, native-ETH contract tests (A2-A5) | Value, deadline, reentrancy and state-transition test results | Reviews Member 1's token accounting |
| Member 3 | Deployment/configuration and secret/lock/verification/claim scripts (B1-B2) | Confirmed transactions and both-chain parameter comparison | Reviews Member 5's observation/recovery |
| Member 4 | Browser wallet, network switch, balances and guided claim flow (C1-C3) | Wallet walkthrough on both testnets, transaction links/errors | Reviews Member 3's public protocol interface |
| Member 5 | Independent state inspection, expiry/refund scripts and UI recovery integration (B3-B4, C3-C4) | Status matrix, timeout/refund test and live recovery trace | Reviews Member 4's invalid-action handling |

Everyone contributes to Task D (report, slides, explanations), attends the
Task E live demo and Q&A, and records Task F evidence. Member 5 coordinates
integration, but every owner writes their own contribution and explains it.
No role implies a fabricated contribution before the code exists.

## Shared work rules

1. Open one issue per deliverable with the acceptance item IDs and owner.
   Agree on the cross-module interface in `docs/architecture.md`.
2. Branch from `main` using a descriptive name such as `erc20-escrow` or
   `refund-observer`. Each PR is small enough for another owner to review.
3. In the PR template, link the issue, describe tests and public testnet
   transactions, list unfinished cases, and disclose any AI-assisted
   functions. A different member reviews before merge.
4. Keep secrets and RPC credentials out of Git. Store only placeholders in
   `.env.example`; the browser uses a connected wallet.
5. Update `README.md` commands and addresses, `Changes.md`, and the
   contribution table as work lands. Record completed and missing acceptance
   items in `.agent/acceptance.md`.

GitHub's branch rules and collaborator invites are repository settings,
not files. Once the five GitHub usernames and a running CI check are known,
protect `main` with pull requests, one other-member approval and the `CI`
checks (`workspace` and `implementation`). Confirm these settings in GitHub
after the workflow is published.

## Presentation handoff

Prepare funded Alice/Bob accounts, deployed addresses and tested RPCs before
27 November 2026. Rehearse separate success and short-deadline refund
instances: attempt the invalid early refund while its lock is active, then
refund it after expiry. Do not deploy during the demo. Presentation:
27 November 2026, 18:30-21:30, FJ303 (four minutes
slides, four minutes live, two minutes Q&A per group). Submit the archive
via Canvas before 4 December 2026, 23:59 (course specification).
