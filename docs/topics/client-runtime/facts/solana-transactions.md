---
title: Solana Transactions
owner: sdk
status: authoritative
area: client-runtime
review_after_days: 30
sources_of_truth:
  - packages/client/src/authorization.ts
  - packages/client/src/session/wallet.ts
  - packages/cli/src/commands/wallet.ts
  - apps/portal/src/features/general/use-svm-wallet-binding.ts
---

# Solana Transactions

For the current Action-based UI/CLI contract and supported adapters, see
[Wallet routing](../../auth/facts/wallet-kit.md). Auto can select an exact SVM
account with `--solana-public-key` without possessing its private key. The
backend checks delegation before execution; sealing a transaction is not AA.
