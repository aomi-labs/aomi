# @aomi-labs/deploy

## 1.0.0

### Major Changes

- 665e1dc: Cut over to owner-scoped funding events and one Card / USDC checkout for account and builder credits. Remove top-up and purchase APIs, end-user BYOK options and funding headers. Consumers must upgrade with the backend; no compatibility adapters are provided.

  Builder grants specify canonical model coverage. App metadata carries fundedModelOnly and sponsoredModelIds inline. Hosting charges debit builder credits, separately from personal Chat credits.

  Use the generated CreditBalance and CreditLedger contracts. credits.get() returns only the balance; load history with credits.ledger(). Remove AomiCreditPosition/AomiCreditActivity and export CreditBalance, CreditLedger and CreditLedgerEntry. The shared checkout component is CreditCheckoutDialog.

### Minor Changes

- cbf4bc6: Bot registrations carry `miniAppLabel`, the label on the Mini App menu button. `miniAppUrl` set to null now means the bot has no Mini App (there is no platform default).
- bb9e018: Remove the unused route factories from `./bff`; it keeps the error, release-manifest, ownership and app status helpers.
- 80677a0: Move the Manager client and BFF implementations into the private `@aomi-labs/internal` workspace package. This removes the public Manager client and BFF entry points from Deploy; external consumers using those APIs must remain on 0.10 until migrated. Deploy continues to provide its wire types, errors, activation helpers, and browser launch client.
- 0f3089f: Add `@aomi-labs/deploy/schemas`: zod schemas for every manager response, which read the snake_case wire and output the camelCase shapes. The exported response types are now inferred from them. Fields the manager may omit read `null` (or `[]`) instead of being optional, and `PlatformApp.loaded` reads `undefined` until a runtime probe answers. `deploymentTargets` takes a parsed deployment.
- 619659c: Move `BackendClient`, `assertServerOnly` and the `./bff` helpers into the workspace package `@aomi-labs/internal` (as `ManagerClient`); `@aomi-labs/deploy` keeps the wire types (now all exported), errors, activation helpers and the browser launch client.
- ea42447: Builders manage a private App's key from Build: `BackendClient.getBuilderAppKey` shows the current key and `regenerateBuilderAppKey` issues a new one, revoking the old. The App key input and the "App key required" notice now point people to the key the App's builder shared.
- Clean cutover of the TypeScript reform. Remove legacy widget exports, subpaths,
  auth props and the SDK wallet option; use signer and curated widget entries.
  Remove CLI command aliases and old state migration. Keep saved OAuth device
  identity and isolate interactive conversation transitions. Build APIs use
  /api/build, with one deployments route family. The Build sandbox signer is
  aomi-build with BUILD_SERVICE_PRIVATE_KEY; Edge remains a separate identity.

## 0.9.4

- Decode the Manager's `ffi_incompatible` and `ffi_unverified_sdk_versions` project fields, so a live app the runtime cannot load is told apart from one whose FFI record is merely missing.

## 0.9.2

- Publish under the MIT license, with a `repository` link so npm can show build provenance.

## 0.9.1

- Use the shared project client transport for deployment lifecycle requests and structured failures.
- Preserve existing deployment command and account authorization behavior.
