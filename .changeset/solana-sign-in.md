---
"@aomi-labs/client": minor
"@aomi-labs/widget": minor
"@aomi-labs/cli": minor
---

Sign in with a Solana key. `wallet(signer)` picks SIWE for an EVM signer and SIWS for a Solana one (`wallet(solanaSigner(key), { cluster })`); the CLI does the same with `--solana-private-key`, takes `--cluster` everywhere, and passes `--rpc-url` to the Solana signer for that cluster. `whoami` names both local signers.

One Solana cluster spelling on the client: `SvmCluster` (`solana:mainnet`, `solana:devnet`, `solana:testnet`) replaces `SiwsChainId`. `normalizeSolanaCluster` still accepts `mainnet-beta`, `solana` and bare names for this release, and answers `undefined` for a cluster it doesn't know. `solanaSigner` broadcasts on the commit's own cluster (a `devnet` commit no longer goes to mainnet) and refuses an unknown one.

Solana message commits (`svm_message`) keep their review: `isMessageReview` and `isMessageCommit` take both families, and a message signature names its reviewed version on every route. The widget lists them with their own family, and its refused-send toasts key on the API error's `code`.
