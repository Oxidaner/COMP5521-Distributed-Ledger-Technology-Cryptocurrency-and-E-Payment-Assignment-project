# Changes from the Lab 4 teaching example

The Lab 4 example is a single-chain learning reference. This project implements a separate ERC20 escrow on Ethereum Sepolia and native ETH escrow on Arbitrum Sepolia with no bridge or direct contract-to-contract cross-chain call.

- Added project-owned OpenZeppelin MST, allowance-based SafeERC20 locks and native ETH locks, unique IDs, indexed creation events, receiver-only claims and sender-only refunds.
- Added explicit Active/Claimed/Refunded states, derived expiry, strict claim-before/refund-at-expiry boundary, custom errors, checks-effects-interactions and ReentrancyGuard. Transfer failures revert the full transition.
- Added shared TypeScript verification of confirmed lock receipts, escrow address, participants, asset, amount, hashlock, deadline and current state before counter-lock or claim. Ordered deadlines leave Bob time to claim MST after ETH reveals the preimage.
- Added resumable deployments, saved private recovery jobs, repeatable success/recovery CLI commands, independent chain observation and sanitized public evidence.
- Added MetaMask guided operation with network switching, balances, MST approval, public-plan exchange, private backup, revealed-secret extraction, errors, links and role/state-gated refund controls.
- Added nine contract and ten protocol tests, CI compile/test/build/evidence checks, strict final identity gate and allowlisted submission packaging.
- Deployed all three contracts and completed success and recovery on the required public testnets on 17 November 2026. Public manifests contain receipts and final states.
- Added the report, editable presentation and timed demonstration runbook. Live delivery, Q&A, real identity and verified student contribution remain personal assessment steps. Actual MetaMask signing needs a human rehearsal.
- Review fixes preserve same-swap secrets and lock receipts on import, reject malformed plan fields before rendering, keep each chain's recovery controls available during an outage of the other RPC, and reject expired first-lock plans before approval and before escrow. Local and browser regressions cover these cases.
- Added the optional private point-lock exchange: separate BN254 escrows, distinct IDs/points/claim scalars, off-chain Schnorr proof and Bob's private offset, proof/receipt checks before counter-lock, both refunds, participant handoff/backups and independent status. Eight new tests cover the extension and wallet/transaction feedback. Actual public-testnet success and refund evidence accompanies the implementation.
- Added unknown-network registration through MetaMask and signature/broadcast/confirmation feedback with immediate pending transaction links. A failed or unavailable confirmation keeps its explorer link and prompts inspection before retrying.

Basic swaps still expose shared hashlocks/preimages. Private swaps require a fresh offset and private peer transcript; reused or leaked offsets weaken privacy, and addresses/amounts/timing remain correlatable. Published grading evidence intentionally pairs the example legs. One confirmation is used for testnet rehearsal, and the implementation does not provide production finality guarantees, automatic relaying, exchange-rate discovery or protection for arbitrary fee-on-transfer/rebasing tokens. The configured MST is a standard fixed-supply ERC20.
