# COMP5521 2026 HTLC Project

This repository is the team workspace for the COMP5521 cross-chain swap
assignment. The authoritative requirements are in
[`docs/COMP5521_HTLC_Project_2026.pdf`](docs/COMP5521_HTLC_Project_2026.pdf).
Implementation has not started. A successful CI run at this stage validates
the workspace only, not the graded exchange.

## Start here

1. Compare the three approaches in [`docs/architecture.md`](docs/architecture.md)
   and record the team's choice before adding toolchain dependencies.
2. Assign five people to the owned deliverables in
   [`docs/collaboration.md`](docs/collaboration.md), then fill in
   [`docs/contributions.md`](docs/contributions.md).
3. Open a task with the GitHub issue template. Work on a short-lived branch,
   open a pull request, and attach the test or transaction evidence.
4. Use [`.env.example`](.env.example) to identify local configuration fields.
   Keep actual credentials in an ignored `.env` file.

The implementation is expected to place the two final contracts in
`contracts/`, repeatable protocol operations in `scripts/`, browser sources in
`src/`, and tests in `test/`. The team will add installation, compile/test,
deployment, frontend, deployed-address and live-demo commands here as those
parts are implemented.

## CI and acceptance

Pull requests run a workspace check. Once implementation files or
`package.json` appear, CI also requires a root `package-lock.json` and these
root npm scripts: `compile`, `test:contracts`, `test:protocol`, `build:web`.
The chosen stack can implement those commands internally. A manually started
final-acceptance job checks the submission file set; on-chain behavior, live
demonstration, report quality and individual contribution evidence still need
human review against [`.agent/acceptance.md`](.agent/acceptance.md).

The course permits AI help only for individual functions and debugging.
Disclose assisted functions in their PRs and in the final report; see
[`AGENTS.md`](AGENTS.md).
