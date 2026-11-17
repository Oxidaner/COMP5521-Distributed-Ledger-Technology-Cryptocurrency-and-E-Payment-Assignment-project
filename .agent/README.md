# Project operating guide

Use the current `docs/COMP5521_HTLC_Project_2026.pdf` for scope and `.agent/acceptance.md` for evidence. The selected design is option 1 in `docs/architecture.md`, operated by one student. The optional private point-lock extension is described in `docs/privacy.md`; its deployments are separate from the basic HTLCs.

Before changing contracts, compare the deployed source and public manifest. A contract change requires new deployment/evidence and updating `src/public-config.json`; local tests alone do not validate an old deployed address. Keep both chains independent and use shared protocol verification before committing the second asset.

For code changes, run the relevant contract/protocol/privacy tests and browser build. Before packaging, run `npm run check:acceptance` and `npm run check:privacy`; use `-- --live` when refreshing public chain evidence, and `-- --submission` for the final identity check. Record only checks actually completed. CI checks consistency and executable behavior, while classroom demo, Q&A and personal contribution require human assessment.

Keep .env, signing keys and deployments/swaps private. Share only sanitized evidence. Build archives through the allowlisted packaging script. Preserve the owner's deleted AGENTS.md and modified specification. Describe assistance accurately in `docs/ai-assistance.md` and request real identity only when needed to finalize contribution fields.
