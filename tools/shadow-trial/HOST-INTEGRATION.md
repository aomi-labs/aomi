# Shadow staging trial

The source patch adds `/dev/shadow-trial` to the existing Aomi Portal. It uses the Portal's normal WalletProviders and exported `useAomiWalletKit`; there is no second wallet host or session bridge. The route is disabled unless `NEXT_PUBLIC_SHADOW_TRIAL_ENABLED=true` and the browser origin is exactly `https://chat-staging.aomi.dev`.

The panel has explicit public-readiness, Prepare, Recover original attempt, status, free-result retrieval and verified unsigned-result controls. Mounting the panel does not fetch, initialize a journal or request a signature. A current positive candidate allowance, EOA source account, matching public verification key, sufficient Gateway Testnet balance, the exact selected payer and reviewed terms are required before Prepare. Public reads stop on error without retry or alternate provider.

Prepare uses the existing approved 0.01 testUSDC trial. The review shows the selected payer, merchant, simulation sender, token, spender and intended `approve(spender, 0)` output with native value zero. The user can select normal acceptance or explicitly withhold the first successful preparation response and then recover the same proof. Recovery reopens the original durable journal and never creates a new authorization. A SHA256 identity bound to the submitted proof verifies the same job and retrieval capability across reopen, before any subsequent status/result request; raw capabilities remain private.

The route is a standard TanStack file route under `apps/portal/src/routes`. The current app-kit `appConfig` installs the existing `tanstackStart` plugin, Portal consumes `routeTree.gen`, and its `type-check` script runs `tsr generate`. No manual route mount or new provider remains to implement.

## Fixed trial terms

| Item | Value |
| --- | --- |
| Origin and route | `https://chat-staging.aomi.dev/dev/shadow-trial` |
| Network | Arc Testnet, 5042002 |
| Approved payer | `0x12216f1365b9af24015baa158cc9e0d2354088a8` |
| Preparation cap | 0.01 testUSDC, including failed preparation |
| Retrieval fee | Zero |
| Merchant | `0xda65d415cc9d5ddc2a08bdffc996750755fc3cf0` |
| Gateway typed-data contract | `0x0077777d7eba4688bdef3e311b846f25870a19b9` |
| Typed-data domain | `GatewayWalletBatched`, version 1 |
| Authorization duration | Backdated 600 seconds; expires 604900 seconds after generation |
| Simulation sender | `0x759674c35a9f34b81f420f17bd2afea04fafd0e9` |
| Token | `0x3600000000000000000000000000000000000000` |
| Spender to revoke | `0x73742278c31a76dbb0d2587d03ef92e6e2141023` |
| Intended result | One unsigned approve(spender, 0), native value zero; no execution |

The separately funded staging Para account beginning `0xf0e` is a different payer and is rejected. Its balance does not establish readiness of the approved Shadow payer. The panel's readiness action reads the intended account and case; it does not request funding, allowance changes or deposits.

## Concrete source and release

Target repository: `aomi-labs/aomi`, base `main`. The publication checkout uses `main` at `2ca7fe19a379012d15a652e5a431e1fa15665d27`. Wallet interface and routing source were originally verified at `485c963c77b0617e154a35f93c0711d036e2a9cc`. The proposed branch is `codex/shadow-staging-trial`.

`apps/portal/src/features/shadow-trial` contains the finished panel, readiness policy and self-contained runtime. `tools/shadow-trial` carries the source/build project, original source attribution, standalone frozen dependency lockfile and evidence and third-party licenses. `tools/*` is outside the verified workspace globs, so this packaging adds no workspace dependency importer or lockfile change. The Portal imports its local runtime artifact; no new SDK dependency is required in Portal to use it.

Final runtime: 641935 bytes, SHA256 `f7937112cdc151055697c3c2abac2a713f99ff9222b78dd621162daccdafd0a6`, built for browser ES modules with no external imports. `pnpm build:check` in the standalone tooling verifies source/artifact consistency and Portal synchronization; the build preserves behavior while normalizing esbuild source labels and removing one incompatible Ajv TypeScript-only lint directive. Runtime statements are unchanged from the browser-tested artifact.

Use the repository-managed `aomi-dev exec --repo frontend` workflow for full checks. The repository checks are `pnpm --filter portal type-check`, `pnpm --filter portal lint`, and `pnpm --filter portal build:app`. Full Portal/workspace checks were not executed in this isolated preparation environment; the scoped strict semantic check, real browser/SDK fixtures and route integration checks are recorded below. Keep the flag absent for the proposed draft PR. Publishing the PR can start CI and preview builds; enabling the staging flag and rolling out the route are separate release actions. Production stays outside this route's origin gate.

## Verification and live boundary

The final code has scoped strict TypeScript validation against actual viem/x402 declarations, 16 host lifecycle cases, 15 readiness/policy cases and 11 actual React DOM integration cases. The real browser journal passed the initial 22 checks, 11 durable submission checks, 9 job-identity/reload checks and 5 read-only identity assertion checks. Base TaskClient browser checks passed 8 cases and guard checks 13 cases. The final actual x402/Circle browser integration passed 9 cases at 13:04:39 UTC, including same-proof recovery, changed replay identity rejection and altered stored capability rejection before status transport. The final host artifact imported inertly in a real browser at 13:05:18 UTC.

WalletKit, service responses and signature recovery in payment fixtures were synthetic; the signature value was invalid all-zero data. These checks establish local client behavior, not live Para acceptance or settlement.

Public staging JWKS returned HTTP200 and matched the retained trusted key at 12:40:18 UTC. A single credential-free Task endpoint OPTIONS preflight from this tool route returned HTTP403 at 12:46:32 UTC with no CORS headers. It was not retried; the evidence cannot attribute that refusal to the API or an intervening relay. Actual hosted browser acceptance remains necessary. The panel preserves the original record if any readiness, transport or wallet step fails.

After an authorized staging rollout, Aomi verifies the live readiness result and the user reviews the exact preparation action in the normal wallet flow. Aomi then verifies the signed preview, original artifact bytes, exact unsigned call, zero retrieval fee and original job recovery before passing evidence to Qdee. The source address-exclusion comparison is complete; no live revocation result or assembled runtime protocol/selector decision has been claimed.


Publication configuration review: the feature flag uses the repository-required `NEXT_PUBLIC_SHADOW_TRIAL_ENABLED` name, one browser reader, the existing public-env allowlist and a documented `false` default. Five targeted configuration checks passed; runtime tests above retain their original timestamps.
