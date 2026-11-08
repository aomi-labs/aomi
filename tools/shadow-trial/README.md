# Shadow staging trial

This adds a default-disabled `/dev/shadow-trial` Portal route for the approved Arc Testnet allowance-revocation preparation trial. It uses the existing normal Aomi WalletKit context, a browser adaptation of the existing TaskClient, the published x402/Circle payment algorithms and durable IndexedDB/Web Locks recovery. It does not execute the returned transaction.

The fixed trial allows at most 0.01 testUSDC for preparation, zero retrieval fees and one identical proof replay. The route requires `NEXT_PUBLIC_SHADOW_TRIAL_ENABLED=true` and the exact `https://chat-staging.aomi.dev` origin. The flag is documented as false in Portal's `.env.example`. Mounting does not fetch, create a journal or request a signature. See [HOST-INTEGRATION.md](HOST-INTEGRATION.md) for the exact case, controls and live acceptance boundary.

## Source and dependency ownership

`src/browser-task-client.ts` adapts the existing product-mono TaskClient at `87c12f2a2eedb22c9b57df749cdcb831861bb048`; original source attribution and hash are in `source-provenance.json`. The original payment/preview/recovery logic is retained. The new code supplies browser runtime interfaces and guarded host composition.

The Circle 3.5.0 client barrel pulls in a Node-only GatewayClient. The browser build therefore includes the exact public BatchEvmScheme and its three runtime support sources from the integrity-verified official package, with selected official type declarations. No signing algorithm was rewritten. The source hashes and license are under `src/vendor/circle-batch-3.5.0`; third-party notices accompany both bundle copies.

This private tooling project is outside the root workspace globs. Its own `pnpm-lock.yaml` pins the source-build dependencies, including x402 2.10.0 and viem 2.47.11. Portal imports its committed self-contained artifact and existing React/WalletKit dependencies. No publishable package, workspace importer, root lockfile or public package API changes.

## Reproduce the artifacts

Use Node 22.13+ and the repository-pinned pnpm 10.28.0 through Corepack. From `tools/shadow-trial`:

```sh
corepack pnpm install --ignore-workspace --frozen-lockfile --ignore-scripts
corepack pnpm build:check
corepack pnpm test:client
corepack pnpm test:guard
corepack pnpm test:actual-sdk
```

`build:check` regenerates in memory and checks the source-backed browser client, actual SDK fixture, host bundle, declared public surface and Portal copies. It normalizes only esbuild source comments/module-factory labels to remove package-manager path differences. `corepack pnpm build` writes those outputs and synchronizes the Portal bundle/declaration. The public declaration is maintained in `src/trusted-host-entry.d.mts` and checked in the scoped semantic validation. It is not inferred from a live wallet.

All three Node test commands use synthetic WalletKit/service/proof data; the actual-SDK command uses the published payment algorithms and an invalid all-zero signature. These commands do not contact a real service or sign anything. Node uses an in-memory journal; real browser durability was tested separately.

For full repository validation, use the managed `aomi-dev exec --repo frontend` workflow and the repository commands `pnpm --filter portal type-check`, `pnpm --filter portal lint`, `pnpm --filter portal build:app`, and `pnpm run check:frontend-boundaries`. Those full-workspace checks remain for the draft PR's CI; they were not executed in the isolated preparation environment. The route uses the supported `@aomi-labs/widget/host-composition` entry and ordinary TanStack file-route generation.

## Validation performed

- Scoped strict TypeScript validation against actual viem/x402 declarations.
- Base browser client 8 cases; guarded browser integration 13 cases.
- Durable browser journal 22 initial cases, 11 submission-counter cases, 9 job-identity/reload cases and 5 read-only identity assertions.
- Published-SDK browser integration 9 cases, including changed replay identity and stored capability rejection.
- Host lifecycle 16 cases; readiness/policy 15 cases; actual React panel 11 cases.
- Inert final host-bundle import in a real browser, with no wallet, network or journal initialization.

The browser payment fixtures replace WalletKit, signature recovery and remote responses with synthetic data. These results establish local client behavior, not live Para acceptance or payment settlement. No full frontend workspace build is claimed. A hosted preview screenshot remains to be attached after the draft preview is available.

The public staging verification key matched the retained trusted key on 8 November 2026. A single credential-free Task OPTIONS request returned 403 without CORS headers; the evidence cannot identify whether the API or an intervening relay refused it. Hosted acceptance therefore remains unverified. `staging-public-jwks-observation.json` and `staging-task-cors-observation.json` retain those bounded observations.

Before enabling the flag, complete the normal staging release review. The panel requires fresh public readiness and explicit reviewed Prepare; wallet confirmation remains the normal per-action user handoff. Recover always reopens the same original journal and proof. There is no reset or replacement authorization path.
