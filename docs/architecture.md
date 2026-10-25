# Architecture options (discussion draft)

Source of requirements: `COMP5521_HTLC_Project_2026.pdf`, Tasks A-F.
The basic project is worth 90/100; the privacy challenge is optional (10).
All options use one ERC20 escrow on Ethereum Sepolia (MST) and one native-ETH
escrow on Arbitrum Sepolia. There is no on-chain cross-chain call.

| Rank | Approach | Strengths | Cost / decision point |
| --- | --- | --- | --- |
| 1 | Hardhat 3, TypeScript protocol scripts, Vite/React browser UI, one root npm workflow | Clear shared interfaces for ABIs and status, one CI toolchain, guided demo UI | More UI setup; confirm the team's familiarity before choosing |
| 2 | Extend the Lab 4 Hardhat workflow, TypeScript scripts, Vite with plain TypeScript UI | Fastest initial ramp if everyone knows the lab | Rework the single-chain example rather than copying its escrow design; UI state management is manual |
| 3 | Foundry for Solidity and tests, TypeScript scripts and Vite/React UI | Strong contract-focused testing and fast local iteration | Two toolchains and extra integration work across five owners |

Recommendation: option 1 for a shared implementation interface and repeatable
local checks. This is a proposal, not a dependency decision. Before adding
configuration, the team should pin the actual tool versions and inspect their
defaults; do not restate defaults in config. Record the selected option and
the reason in this file after the discussion.

## Protocol common to all options

1. Alice generates a private preimage `s`, publishes `H = keccak256(s)`, and
   locks MST for Bob on Ethereum Sepolia with the longer deadline `T_MST`.
2. Bob independently reads the confirmed MST transaction and verifies chain,
   contract, sender, receiver, MST token, amount, `H`, deadline and active
   status. Only then does he lock ETH for Alice on Arbitrum Sepolia with
   `T_ETH < T_MST`.
3. Alice independently verifies Bob's confirmed ETH lock, then claims ETH
   before `T_ETH`, revealing `s` in the Arbitrum transaction/event. Bob reads
   the revealed value and claims MST before `T_MST`. Each chain is queried
   independently for final state and transaction hashes.
4. If the second lock never happens, Alice refunds MST after `T_MST`. If
   neither claim happens after both locks, Bob refunds ETH after `T_ETH`, and
   Alice refunds MST after `T_MST`. Current on-chain state controls which
   actions are offered.

Choose `T_MST - T_ETH` to cover confirmation, observation and manual action
time on both chains. Contract deadlines are absolute timestamps; a claim
must be included before expiry and a refund can succeed only after expiry.
The UI must never infer the opposite chain's state from a local event alone.

## Acceptance-focused interface decision

Agree on the swap identifier format, lock event fields, status/error names,
deadline boundary and the script output schema before parallel coding.
Each operation should return chain ID, contract, swap ID, transaction hash,
confirmed block and current state. The UI can consume the same protocol
definitions as scripts without importing private signing material.

Optional privacy work starts only after successful and refund flows pass
on both chains. A hidden frontend field does not meet the challenge: the two
public hashlocks/preimages must be unlinkable while retaining atomic claims
and refunds.

## Decision record

- Choice: pending team discussion.
- Decision owner/date: pending.
- Consequences or deviations: pending.
