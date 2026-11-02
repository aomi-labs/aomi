# @aomi-labs/service-identity

## 0.2.1

### Patch Changes

- Select the prepared production Edge and Build signing identities for the cutover. Staging, rc and development identities are unchanged.

## 0.2.0

### Minor Changes

- 52cc789: Publish `@aomi-labs/service-identity`, the runtime-agnostic service topology engine. `@aomi-labs/account` depends on it, so a public package can no longer depend on a workspace-private one.
- Clean cutover of the TypeScript reform. Remove legacy widget exports, subpaths,
  auth props and the SDK wallet option; use signer and curated widget entries.
  Remove CLI command aliases and old state migration. Keep saved OAuth device
  identity and isolate interactive conversation transitions. Build APIs use
  /api/build, with one deployments route family. The Build sandbox signer is
  aomi-build with BUILD_SERVICE_PRIVATE_KEY; Edge remains a separate identity.

### Patch Changes

- 73a2e6e: A delegated bearer's `auth_source` may be `widget`, so a widget-started call no longer reads as a portal session.
