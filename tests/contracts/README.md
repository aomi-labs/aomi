# Consumer compatibility acceptance

`node scripts/check-consumer-compatibility.mjs --base <trusted-base-sha>` packs the
candidate client, React runtime, and widget packages. It installs their tarballs
into the headless and widget examples copied from the trusted base commit, then
compiles and builds those examples. The headless example's TypeScript source
alias is removed in the temporary copy so it resolves the packed client.

The baseline isolation test creates a small Git repository, commits a consumer
that imports `Aomi`, commits a candidate change to import `NewAomi`, and verifies
the extracted test consumer still imports `Aomi` from the base commit. It also
rejects a missing base consumer. Three CLI cases reject missing, all-zero,
and unknown baseline revisions before packaging. Run these with
`node --test tests/contracts/*.test.mjs`.

On 2026-09-13, the full check passed against base `cc556219`: headless TypeScript,
11 headless tests, packed ESM/CommonJS imports, widget TypeScript, and Vite
production build. For negative acceptance, the isolated installed client's
`dist/index.d.ts` export of `Aomi` was temporarily removed. The unchanged
trusted-base headless consumer then failed compilation with TS2459 at seven
`Aomi` imports. Restoring that declaration made the same build pass again.
The mutation was confined to the temporary install and was not committed.

The widget fixture previously inherited `@assistant-ui/react` from the trusted
workspace root and `@solana/spl-token` from the trusted widget development
dependencies. The harness supplies those two existing versions explicitly in
the temporary host. This preserves the original fixture environment without
allowing candidate package manifests to add new host dependencies silently.
