# Hosted wallet browser journeys

`hosted-wallet-journeys.spec.ts` drives the existing Portal at
`https://chat-staging.aomi.dev` through its normal wallet picker and same-origin
auth/chat routes. Playwright registers an injected EVM provider or Solana Wallet
Standard provider before hydration. The private keys stay in the test runner;
only the exact Portal SIWE/SIWS challenge can be signed. The server verifies the
signature and creates the real Better Auth session. No test fabricates a session
cookie or a successful chat response.

The third scenario selects Direct execution and asks the hosted model to use
the connected wallet's attended `human_sync` path to construct and simulate one
native transfer of exactly 1 wei on Base Sepolia (chain 84532) to
`0x0000000000000000000000000000000000000000`. It checks the pending action's
sender, recipient, chain, value, empty calldata, approvals, simulation result,
and the rendered `0.000000000000000001` native-token outflow. Fee estimates
remain distinct from the transfer amount. The test never clicks **Send to
wallet**. All provider transaction methods reject, and browser routes that
could broadcast or approve a transaction are aborted and counted as failures.
The prompt explicitly forbids Privy delegation because this case verifies the
attended wallet-review path, not autonomous custody.

The trusted `Hosted Wallet E2E` workflow runs only by manual dispatch or an
opt-in weekday nightly schedule. It checks out main, uses one Chromium worker,
has a 16-minute job cap, and stores no Playwright trace, screenshot, or video.
Pull-request jobs and previews do not receive signing keys. The workflow's
`staging-e2e` environment is restricted to the `main` branch in GitHub's
deployment branch policy. Keep that rule in place when adding the following
secrets; workflow code alone cannot protect them from a branch-selected manual
run:

- `AOMI_HOSTED_E2E_EVM_PRIVATE_KEY`: a dedicated disposable EVM key; the same
  wallet must have a small native-token balance on Base Sepolia for the transfer
  scenario.
- `AOMI_HOSTED_E2E_SVM_SECRET_KEY`: a separate disposable 64-byte Solana secret
  key, encoded as a JSON byte array or base58 string.

The staging workflow pins `AOMI_HOSTED_E2E_CHAIN_ID=84532` and the public HTTPS
Base Sepolia RPC directly in its environment. Its preflight validates both
wallet inputs and confirms the RPC reports chain 84532 before installing
dependencies or Chromium. Set the repository variable
`AOMI_HOSTED_WALLET_E2E_NIGHTLY=1` only when the nightly run is wanted. The
default workflow target is the canonical staging Portal. No production wallet,
personal wallet, funding action, local chain, local backend, or browser
extension is part of this test.

To run locally, supply those variables to the process and run
`pnpm exec playwright test --project=hosted-wallet --workers=1`. Missing keys,
RPC, balance, auth, model, or simulation make the required scenario fail; none
is skipped. Run the two login scenarios alone with `--grep 'signs a real
challenge'` when there is no funded EVM wallet yet, and report the burn scenario
as unverified.
