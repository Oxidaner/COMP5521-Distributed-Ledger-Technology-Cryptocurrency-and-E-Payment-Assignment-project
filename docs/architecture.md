# Architecture decision

Source of requirements: `COMP5521_HTLC_Project_2026.pdf`, Tasks A-F.
The basic project is worth 90/100; the privacy challenge is optional (10).
All options use one ERC20 escrow on Ethereum Sepolia (MST) and one native-ETH
escrow on Arbitrum Sepolia. There is no on-chain cross-chain call.

| Rank | Approach | Strengths | Cost / decision point |
| --- | --- | --- | --- |
| 1 | Hardhat 3, TypeScript protocol scripts, Vite/React browser UI, one root npm workflow | Clear shared interfaces for ABIs and status, one CI toolchain, guided demo UI | More UI setup; confirm the team's familiarity before choosing |
| 2 | Extend the Lab 4 Hardhat workflow, TypeScript scripts, Vite with plain TypeScript UI | Fastest initial ramp if everyone knows the lab | Rework the single-chain example rather than copying its escrow design; UI state management is manual |
| 3 | Foundry for Solidity and tests, TypeScript scripts and Vite/React UI | Strong contract-focused testing and fast local iteration | Two toolchains and extra integration work across five owners |

Decision: option 1 selected by the sole student on 2026-10-28. Use Hardhat 3,
TypeScript, ethers v6 and React/Vite. The local Hardhat networks use the two
required chain IDs so integration tests exercise chain separation. Node 24 is
the pinned runtime target. Package versions are exact-pinned in `package.json`.
Hardhat compiler profiles and simulated networks follow the pinned Hardhat 3
template; only the two local network entries needed for this project are
specified. Solidity compiler is pinned at 0.8.28. OpenZeppelin defaults such
as ERC20's 18 decimals remain unmodified.

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

- Choice: Hardhat 3 + TypeScript + ethers v6 + React/Vite.
- Decision owner/date: sole student, 2026-10-28.
- Consequences or deviations: one npm workspace and lockfile; two independent
  local chains; the basic HTLC delivery remains available alongside the separate privacy extension added on 2026-11-18.

## Confirmed interface decisions

- `swapId`: random `bytes32` generated off chain and reused on both chains.
- Preimage: exactly `bytes32`; `hashlock = keccak256(abi.encodePacked(preimage))`.
- Stored states: `Active`, `Claimed`, `Refunded`; expiry is derived from time.
- Boundary: claim only when `block.timestamp < timelock`; refund when
  `block.timestamp >= timelock`.
- `SwapCreated` fields are indexed swap ID, sender and receiver, then asset,
  amount, hashlock and timelock. ETH uses `address(0)` as its asset.
- `SwapClaimed(swapId, preimage)` publicly reveals the preimage;
  `SwapRefunded(swapId)` records the refund.
- Sender and receiver must be nonzero and distinct.
- Deploy a project-owned MST for the testnet assignment. Use OpenZeppelin
  ERC20 and SafeERC20, plus safe native-ETH transfer and reentrancy protection.
- Alice and Bob are separate MetaMask test accounts. Testnet RPCs and signing
  keys remain local. The browser uses MetaMask without private keys.
- Default protocol durations: ETH 600 seconds and MST 1200 seconds, with a
  script override. Local tests advance timestamps instead of waiting.
- Frontend is browser-only, React/Vite and ethers v6.

## Optional extension decision, 2026-11-18

The owner requested the remaining Task C and Challenge work. Use the specification's point-lock alternative: separate `PrivateHTLC` deployments use Ethereum BN254 ECMUL, and an off-chain Schnorr proof binds the private relation to both complete lock terms. Bob owns a fresh offset; Alice's first claim lets only Bob derive the distinct second claim before publication. Independent IDs avoid an additional shared on-chain marker. `@noble/curves@1.9.0`, already pinned transitively by ethers, is now a direct exact dependency for its public BN254 G1 interface. No curve defaults or Hardhat network/compiler options change. See `docs/privacy.md` for the protocol, failure cases and metadata limitations.
