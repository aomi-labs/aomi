# @aomi-labs/cli

## 0.1.2

- Add `tx preflight`, a read-only check of which catalogued wallets can fund an exact ERC-20 transfer on their own chains, including native gas. It never signs.
- Report the effective connection origin and its configuration source with `aomi config current`, without exposing credentials or requiring a signing key.
- Document staging and Portal/BFF configuration and the Commit review, signing and retry flow.
- Validate a clean CLI install alongside the client migration shim, and from the public registry after publication.

## 0.1.1

- Read simulation step evidence under `result` as well as `execution`, so passed batches no longer render as failed with zero gas.

## 0.1.0

- Publish the CLI independently as @aomi-labs/cli while retaining compatibility forwarding from the client package.
- Pin the command parser to its tested pre-1 release.
- Share account graph and project transport with the public client, including typed HTTP failures.
- Read and update account or thread guard policy using the backend's authoritative revision.
- Keep headless signing, execution and payment capabilities aligned with the widget runtime.
