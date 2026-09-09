# @aomi-labs/client

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
