# @aomi-labs/cli

## 0.1.2

- Add `aomi tx approve <ref>` to approve an agent-wallet commit that is waiting for approval (CLI login sessions only), then follow it to its explorer link or failure code.
- Add `aomi wallets` (the account's wallets and their signing rules) and `aomi wallets use <id>` (the session thread's active wallet).
- `aomi chat` names `aomi tx approve <ref>` and the sign URL when a turn's commit waits for approval.

## 0.1.1

- Read simulation step evidence under `result` as well as `execution`, so passed batches no longer render as failed with zero gas.

## 0.1.0

- Publish the CLI independently as @aomi-labs/cli while retaining compatibility forwarding from the client package.
- Pin the command parser to its tested pre-1 release.
- Share account graph and project transport with the public client, including typed HTTP failures.
- Read and update account or thread guard policy using the backend's authoritative revision.
- Keep headless signing, execution and payment capabilities aligned with the widget runtime.
