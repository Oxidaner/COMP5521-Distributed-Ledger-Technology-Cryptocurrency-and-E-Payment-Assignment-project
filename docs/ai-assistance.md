# AI assistance and provenance

The project owner requested direct implementation. The current project PDF does not contain the previously quoted restriction on whole-component AI implementation. This document describes actual assistance rather than attributing generated work to a student.

| Work | Assistance supplied |
| --- | --- |
| Contracts | AI generated MST, ERC20HTLC and ETHHTLC constructors, lock/claim/refund functions, state/events/errors and local transfer-safety test fixtures. |
| Protocol | AI generated `createPlan`, `validatePlan`, `importSwap`, `checkChain`, `readSwap`, `assertLock`, `verifyLock`, `lockMst`, `lockEth`, `claimSwap`, `refundSwap`, `revealedPreimage` and receipt confirmation logic in `shared/protocol.ts`, including the review fixes and regression tests. |
| Wallet/hash helpers | AI generated `createHashlockMaterial`, `connectMetaMask`, `parseChainId`, `switchMetaMaskNetwork` and their tests. |
| Scripts | AI generated deployment/resume, CLI success/recovery/inspection, acceptance verification and submission packaging. With locally configured test accounts, the agent executed testnet deployment and both swap scenarios. |
| Browser | AI generated the Dashboard and SwapWorkspace views, wallet/account listeners, refresh logic, plan/secret handling and action controls/styles. |
| Tests/CI | AI generated contract and independent-chain tests, browser smoke checks, evidence checks, GitHub workflow and templates. |
| Privacy extension and Task C completion | AI designed and generated the offset point-lock construction, Schnorr transcript/proof, `PrivateHTLC`, private protocol/deployment/verification scripts, browser handoff and recovery, eight regression tests, network-add fallback and pending-transaction feedback. The agent executed the extension's configured testnet success and recovery and drafted the privacy evaluation and updated artifacts. This is not independently authored student work. |
| Documents | AI drafted architecture, README, acceptance map, changes, contribution template, report, presentation and demo runbook from the supplied requirements and observed results. |
| User actions observed in this chat | The user created Alice/Bob MetaMask accounts, obtained test funds, selected the architecture and supplied local configuration. |

Student review, understanding, additional changes, live MetaMask operation and Q&A must be recorded only after they occur. No real name, student ID, classroom performance or unobserved student authorship has been invented. See `docs/contributions.md` for the outstanding identity and contribution fields.
