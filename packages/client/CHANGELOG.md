# @aomi-labs/client

## 0.10.1

- Expose typed context budget and compaction events.

## 0.10.0

- Prepare guest sessions on first composer interaction and join preparation before the first send; retain existing cookies and explicit account credentials.
- Fence anonymous conversation requests when renewal returns a different guest identity; keep backend ownership checks authoritative.

- Keep Better Auth core aligned with the auth and OAuth client release so strict fresh npm installs resolve compatible fetch peers.

- Add shared account graph and project transport, structured fetch errors and scoped browser storage.
- Emit stable public UserState declarations and a browser authentication entry; move the CLI to its own package.

## 0.7.5

- Normalize backend-owned Library `feature_catalog` and registration metadata
  while keeping same-name hosted apps distinct by application ID.

## 0.7.4

- Correct Arc Testnet native-currency metadata to 18 decimals, matching the
  chain RPC and wallet network configuration.

## 0.7.0

Pipeline contract correction and transaction routing surfaces.

### Breaking

- Pipeline Build values are version 2. `EvmStagedBuild`, `EvmSimulatedBuild`,
  `SvmStagedBuild`, and `SvmSimulatedBuild` now carry the server's native
  action records plus `origin`, `expiresAt`, `digest`, and `attestation`.
  Pass the complete value through simulate and commit; do not reconstruct it.
- Removed `EvmStagedAction`, `SvmStagedAction`, `EvmPresentedAction`,
  `SvmPresentedAction`, and `PipelineTransactionReceipt`. Commit results are
  `PipelineEvmCommitResult` / `PipelineSvmCommitResult` with `result` or
  `results` plus `requests`; commit never manufactures a wallet Action.
- `pipeline.evm.stage` rejects a per-call `from`; `pipeline.svm.stage` rejects
  `cluster`/`feePayer` overrides and non-base64 instruction data.
- CLI: `--aa-provider` and `--aa-mode` are rejected. `--aa` and `--eoa` only
  assert the kind of an already-prepared Action; `--eoa` rejects only a
  backend-prepared AA owner authorization and passes ordinary, permit, and
  Solana Actions through.

### Added

- `UserState.route(state, profile)` selects the submitter before a turn: Auto
  with an active delegation defaults to `hosted` (an explicit `venue` stays).
  It never throws; the backend commit gate is the authority.
- `UserState.sameAddress` (case-insensitive EVM, exact SVM).
- `userState.evm.broadcaster` / `userState.svm.broadcaster` (`wallet` |
  `hosted` | `venue`) on the Agent API contract.
- CLI `--solana-public-key` selects an exact SVM account without its key.
- Typed SVM Build actions: `SvmBuildAction` (tagged by `lane`),
  `AssembledSvmInstruction`, `SvmAssembledAccountMeta`; `PipelineActionSummary`
  is a structural interface again.
