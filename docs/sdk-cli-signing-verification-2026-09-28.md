# SDK and CLI external signing verification

Workspace: `sdk-cli-signing`, branch `work/sdk-cli-signing`.
Frontend baseline: `c882c84166540e7822818456d8d3e26e0f264d09`.
Backend baseline: `04b7caa12ae3a4a058e89c701866a2d37da3d969`.
Published CLI baseline: `@aomi-labs/client@0.9.4`.

This record distinguishes deployed results from local integration checks.
Incomplete checks are not passes.

## Captured deployed failures

Target: `https://chat.aomi.dev`, Base mainnet (8453).
Authorized test wallet: `0x28581d8065dA7e25710F25F9DD30F9d361757A7D`.
Initial wallet balance: 0.000211786008159268 ETH; nonce 106.

The published CLI's native SIWE login and account read succeeded. A new chat
staged and simulated a one-wei native self-transfer with empty calldata and
wallet broadcasting. The backend returned:

- Thread: `e181bec1-8c3e-45cd-b8bf-a42822ba45c4`.
- Commit: `8158f1a4-f05f-48e9-9e48-f7cc18f95a51`.
- State: `needs_signature`; action: `sign`; no legacy Actions.
- `tx list --json` returned `{ "active": true, "actions": [] }`.
- `tx sign <commit-id>` failed with `Pending Action ... was not found`.

A second failure was verified with direct authenticated reads: the commit
returned HTTP 403 for the SIWE session but HTTP 200 for the CLI's persisted
guest credential. The CLI sent the guest identity to the public Agent API
despite already being signed in, then used the signed-in identity on the commit
API. The deployed public Agent API accepts the SIWE session (session list HTTP
200), so a guest fallback is unnecessary and incorrect.

The baseline commit was rejected through its owning guest credential (HTTP 200,
state `rejected`). No transaction was broadcast during reproduction.

## Local environment

The paired local stack uses its own database
`aomi_sdk_cli_signing_ea3253c9_20dc85d803`, on loopback PostgreSQL port 54322.
All 144 canonical migrations applied; no pending versions or checksum mismatch.
The local Portal origin is `https://agent.minuet-salary.ts.net:3449`.
Execution uses configured Base mainnet RPC, not an Anvil execution wallet.

The installed launcher omitted Payment and Commit Service. Runtime preparation
uses the existing `aomi-workflow-commit-service-runtime` launcher explicitly,
without changing the global skill link. A private, ignored launch adapter
renders the selected Commit Service RPC configuration to main's fixed config
filenames. Backend product source is unchanged.

The local Portal started and SIWE login verification returned HTTP 200. Its
first `/v1/account` request then exceeded the 240-second cold Portal compilation
window under the default Next.js development runtime while the machine was
under build load. This is not an authenticated account-read pass; local
end-to-end checks remain open. The runtime inherited an 18 GiB JavaScript heap
limit inside an 8 GiB `memory.high` cgroup; a further retry is configured for a 4 GiB heap
limit with the default Turbopack runtime. That retry was not completed before
wrapping up this change. This is a resource diagnosis, not a
product configuration change.

## Candidate deployed results

The SDK's personal-sign request `88fb4f6d` and typed-data request `9d8748db`
were signed and both recovered the authorized wallet address. The SDK's durable
Commit `d4da5343` in thread `ce7c7276` completed a one-wei Base self-transfer;
its receipt has transaction hash
`0x2db24b1fe052c5d005583e1c3411a28882ae4233a5920a5cad93314dca997f34`,
block 51896266, and gas used 21062.

The candidate CLI's Commit `588a93a7` in thread `5142e8d3` completed a second
one-wei Base self-transfer. Its receipt has transaction hash
`0x0305e92dc4ec09a1db34949260ef8079a57ecac688d4e9e1999e0fa61b001e7c`,
block 51896361, and gas used 21062. The two one-wei transfers were sent to
the same wallet; the balance change was gas only, 227311165195 wei across
both transactions. These receipts verify broadcast and inclusion for these
two prepared transfers, not every supported chain or transport.

The public SDK SIWS disposable-key example passed against the deployed Portal:
challenge and verification succeeded, and the authenticated Agent session read
returned zero visible sessions. It generated an unfunded key in memory, made no
Solana transaction, and did not print the secret or session token.

A third Base self-transfer used the CLI's external signing handoff without
giving the CLI a private key. Commit
`647c5689-f68c-4d18-8fb7-7150387d2f1b` confirmed with transaction hash
`0x805a0f90a46664211138a28bd81073e73bed9e38a570d64a95d645a7a3eeedcf`,
block 51896825, and gas used 21062. On the first `tx submit --tx-hash`, the
backend watcher had already marked it confirmed, so the CLI returned an error.
The corrected CLI accepts a repeat report only when the supplied hash equals
the authoritative confirmed transaction ID; the repeat exited successfully
with state `confirmed` and made no further POST.

The deployed guest Agent example passed. The guided walkthrough passed its two
Agent turns, session/account reads, and reported Pipeline as unavailable to
guests on this deployment. The account credits example passed its read path;
no top-up was requested. The wallet terminal completed SIWE authentication,
showed the full personal-sign Action payload before approval, and exercised
both approval and rejection. The SIWS example's authenticated Agent read passed
as noted above. Separate public OAuth device clients for Agent and Pipeline
each completed DCR (201), device verification (200), approval (200), and their
matching device and supplied-token examples. One DCR client cannot be assumed
to authorize both exact REST resources.

## Story matrix

| Story                              | Expected                                                                   | Observed                                                                                                 | Verdict                    |
| ---------------------------------- | -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | -------------------------- |
| Published CLI SIWE login           | Wallet identity authenticated                                              | Native SIWE login succeeded                                                                              | PASS                       |
| Published CLI commit discovery     | Pending commit visible and signable                                        | Empty Actions; commit selector rejected                                                                  | FAIL (baseline)            |
| Published CLI principal continuity | Agent and commit share identity                                            | Guest Agent, signed-in commit read returns 403                                                           | FAIL (baseline)            |
| Candidate SDK EVM messages         | Personal and typed-data signatures recover signer                          | Both recovered authorized wallet                                                                         | PASS (deployed)            |
| Candidate SDK EVM Commit           | Prepared one-wei self-transfer signs, broadcasts, and confirms             | Receipt at block 51896266, gas 21062                                                                     | PASS (deployed)            |
| Candidate CLI EVM Commit           | SIWE identity resumes and signs prepared Commit                            | Receipt at block 51896361, gas 21062                                                                     | PASS (deployed)            |
| CLI external signer handoff        | Export, externally sign, and submit exact prepared Commit without CLI key  | Commit `647c5689` confirmed at block 51896825, gas 21062                                                 | PASS (deployed)            |
| CLI confirmed hash repeat          | Repeat report of same authoritative transaction after watcher confirmation | State `confirmed`, no additional POST                                                                    | PASS (deployed after fix)  |
| SDK SIWS disposable auth           | Fresh unfunded key authenticates and reads Agent                           | SIWS verified; session list read succeeded                                                               | PASS (deployed, auth only) |
| Shipped guest examples             | Agent, walkthrough, credits read, SIWE terminal review                     | Agent and account paths passed; guest Pipeline explicitly skipped; personal Action approved and rejected | PASS for stated paths      |
| OAuth examples                     | Separate Agent and Pipeline public device clients and supplied tokens      | Each DCR 201, verify 200, approve 200; matching examples passed                                          | PASS (deployed)            |
| Local candidate stack              | Same flows against local Portal and backend                                | SIWE verify 200; cold account route compilation timed out                                                | PENDING                    |

## Endpoint matrix

| Endpoint / credential                                         | Expected                                                  | Observed                                                        | Verdict                               |
| ------------------------------------------------------------- | --------------------------------------------------------- | --------------------------------------------------------------- | ------------------------------------- |
| SIWE nonce/verify via published CLI                           | Successful login                                          | Login succeeded                                                 | PASS                                  |
| Public Agent session list / SIWE                              | 200                                                       | 200                                                             | PASS                                  |
| Commit GET / SIWE, guest-owned baseline commit                | Ownership enforced                                        | 403                                                             | PASS (boundary); exposes CLI mismatch |
| Commit GET / owning guest                                     | 200                                                       | 200, needs_signature                                            | PASS                                  |
| Commit manual rejection / owning guest                        | 200, rejected                                             | 200, rejected                                                   | PASS                                  |
| OAuth device registration / Agent and Pipeline                | One exact-resource client per flow                        | Separate DCR 201, verify 200, approve 200, example calls passed | PASS (deployed)                       |
| External CLI `tx submit --tx-hash` after watcher confirmation | Same prepared hash may be reported again without mutation | Confirmed response, no POST                                     | PASS (deployed after fix)             |

## External signer classification

| Axis                   | Existing source of truth                                                                     | Behavior preserved                                                                                                                                                                                                            |
| ---------------------- | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Signer provenance      | Linked wallet `kind: external` and SIWE/SIWS auth provider; Privy/Para are managed providers | Settings labels external wallets explicitly and reserves provider signing controls for Privy/Para. No schema migration is needed.                                                                                             |
| Account signing policy | Durable `SigningPolicy.mode`, authorization version, and signed permit audit                 | Existing manual/client-auto/server-auto grants and explicit `denied` remain stored and enforced. Displaying an external signer does not rewrite a grant.                                                                      |
| Commit execution route | `SigningDecision` plus envelope and broadcaster capability checks                            | Owned manual wallets retain supported wallet, AA Hosted, and SVM Venue/Hosted routes. Reclassifying them as the existing wallet-only `SigningDecision::External` would regress those routes, so this change does not do that. |

Validation: the final client/BFF regression suite passed 425 tests (one
existing skipped test), including batch ordering and idempotent hash reporting.
The headless examples passed 20 tests and typecheck; client typecheck, five
account UI tests, and Portal typecheck passed. Packed trusted-base consumer
compatibility passed. Client version is 0.9.5; widget version is 3.0.11.

Not verified: complete local candidate Agent/Commit integration and browser
review paths. The local services were stopped while wrapping up the PR.
No funded Solana transaction, managed Privy/Para execution, or credit top-up was
performed.
Deployed Pipeline guest catalog requests returned 403 `insufficient_scope`
because that deployment disables guest Pipeline access. The guided walkthrough
reports the skip; it does not treat the policy denial as a successful Pipeline
call.

## Main rebase and review follow-up — 2026-10-02

Rebased PR #687 onto frontend main
`78827e133fc1e3762b4b7fb29f576afd1f2686b5` (PR #688).
The conflict resolutions retain main's wallet outcome recovery and rejection
handling, submission phases, transaction-safety transport and proxy route,
Pipeline durable continuation, and grouped account layout. The external signer
label uses the current shared StatusPill. Package versions now follow main:
client 0.9.10 and widget 3.0.18.

Both original inline findings remained valid and are fixed:

- The terminal groups commits by each batch's first appearance and orders its
  members by batch index. Interleaved batches and independent commits have
  deterministic ordering without mutating the input.
- Execution with an explicit version review now requires the durable review
  digest when one exists, matching external submission. Historical commits
  without a durable review and existing calls without explicit review retain
  their supported behavior.

Main also introduced an Array.findLast call into SDK callback detection. The
headless example's ES2022 source typecheck rejected it. An equivalent reverse
scan preserves the callback behavior and consumer compiler contract.
A facade regression additionally covers the retained Pipeline continuation and
transaction-safety transport.

The backend manual transition was inspected for the review's possible race:
CommitService.manual serializes by the request lock, reloads the record under
that lock, verifies signatures against the stored prepared payload, rejects
conflicting signed bytes, checks current authority and dependencies, and binds
broadcast reports to the stored transaction ID. No backend change is part of
this PR. This is source inspection, not a new live backend execution test.

Validation on the rebased candidate:

- Final client/BFF suite: 501 passed, one existing skipped test.
- Headless examples: 22 passed; account management: five passed.
- Client, headless example, and Portal typechecks passed.
- Package builds, frontend dependency boundaries, and scoped ESLint passed.
- Callback regression suite after the ES2022 fix: 14 passed.

- Packed consumer compatibility passed against unchanged consumers from the
  main baseline, including isolated installs, SDK imports, packed CLI loading,
  and widget builds.
- Production Portal build and all 16 required browser scenarios passed, with
  zero skips, failures, or flaky cases. Existing visual snapshots passed and
  needed no file changes. Authentication, account isolation, wallet lifecycle,
  and packaged widget contracts were exercised against the controlled upstream.

The first production browser build exceeded the managed 6 GiB memory ceiling
while Next.js collected page data with 17 workers. The successful retry used
`CIRCLE_NODE_TOTAL=5`, which selects four Next.js workers, under the unchanged
managed memory ceiling. The snapshot-update setting produced no changed golden
files. GitHub CI must pass on the final pushed revision before merge.
The deployed wallet receipts above remain historical evidence, not fresh
on-chain tests of this rebase.

Hosted CI exposed an existing Para startup fallback race during account switching:
after connector libraries loaded, the readiness timeout moved the host out of
ParaProvider and remounted wallet runtimes, closing the open sign-in dialog.
The loaded provider now stays mounted while its failure banner appears. The
pre-connector fallback remains available when the provider cannot render at all.
A regression preserves an open wallet picker and a single runtime mount across
timeout and late readiness; all 10 Para plugin tests and scoped lint pass.
The mandatory browser scenarios and snapshots were not relaxed.

The same trace opened the picker in the cold placeholder before any external
wallet runtime existed. The wallet chip now stays disabled and reports busy
until the kit is ready or exposes connection options. External wallet options
remain usable while additive provider authentication is still booting.
