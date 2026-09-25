---
title: Wallet routing
owner: frontend
status: authoritative
area: auth
review_after_days: 30
sources_of_truth:
  - apps/shadcn-registry/src/lib/wallet-kit/context.tsx
  - apps/shadcn-registry/src/lib/wallet-kit/composer/wallet-state.ts
  - apps/shadcn-registry/src/components/account-shell/features/account/use-account-acl.ts
  - packages/client/src/user-state/index.ts
  - packages/client/src/session/index.ts
---

# Wallet routing

Portal exposes both configured account providers, Privy and Para, in the wallet
picker. The host selects one provider SDK at a time and opens its sign-in flow;
device authorization routes remain pinned to the requested provider. Choosing a
login provider does not grant delegation or select an Auto transaction account.
The explicit provider choice is remembered on this browser. Restore it before
mounting an SDK; a reload must neither open login again nor briefly exchange
credentials from a different default provider.

The composer is the account-aware authority for wallet state. It intersects
live transport connections with the account's linked wallets, provider signer
readiness, and one stored selection per account and family. The resulting rows
and operating wallet are consumed directly by the picker, Settings, identity
publication, and signing-policy controls. The registry remains transport-only.

For a signed-in account, an operating wallet must be linked and locally
signable. Embedded wallets additionally require a hydrated provider signer and
an exact server-attested address match. A connected external wallet may remain
unlinked and expose Link, but it is not published to the agent. A connected
embedded address that is not attested is a mismatch and must reauthenticate; it
never falls back to challenge-linking. Linked embedded wallets whose provider
is not mounted remain visible with an explanation and Unlink, but no dead-end
Connect action. Guests may operate connected external wallets only.

Selection is stored in localStorage by canonical account id and family. A
valid stored selection wins; temporary unavailability retains it and produces
no operating wallet. A permanently invalid selection is cleared. With no
stored selection, exactly one eligible wallet is selected; multiple eligible
wallets require an explicit choice. Connecting another wallet never takes over,
while an explicit successful Link records that wallet as the selection.

Authorization and bind requests name the exact operating signer. Para resolves
that address to its SDK wallet ID, signs EIP-712 once and checks EVM recovery,
or signs Solana message bytes unchanged. Its Web SDK returns Ed25519 signatures
in base64. A mode stays pending until the existing backend permit commit
succeeds; no UI availability check replaces backend linked-owner, exact-wallet,
expiry, or version checks.

## Widget library 3.0 migration

`@aomi-labs/widget-lib` 3.0 changes `AomiWalletKit.identity.address` and
`identity.svmAddress` from the transport-active addresses to the account-aware
operating addresses. Either is absent when no linked, signable selection exists.
Transport state remains available through `accounts`; canonical UI/domain state
is exposed through `wallets`. The old `walletModalRows` contract was removed.
Consumers that fund, quote, prepare, or sign must read `identity.*`, while
connection-management UI should project `wallets`.

Auto-approve (`client_auto`) is caller-side behavior. It is not server Auto and
does not create delegation or enable an agent wallet.

Changing a signing mode opens an Aomi confirmation dialog with the exact wallet,
current/proposed mode, and permission consequences. **Review change** fetches
the unsigned backend challenge and displays its full EIP-712 JSON (EVM) or
decoded signable message (Solana). **Sign to approve** signs that exact payload
and submits the existing permit; it never regenerates the challenge silently.
Cancel/Escape do not sign or commit. An expired permit or changed policy version
requires another review; repeated confirmation cannot duplicate signing work.

After confirmation, an embedded wallet may sign using its existing session
without another popup. The dialog discloses this explicitly. Aomi does not force
a native provider popup or block Para for lacking one. Ordinary signing is
unchanged. The backend still verifies the signed permit's exact authority,
version, and expiry; the Aomi dialog is not cryptographic proof of user presence.

Authorization (Manual/Auto), submission (Wallet/Hosted/Venue), and execution
(ordinary transaction/AA) are separate. A connected wallet is an identity and
capability, not a promise that it submits every transaction.

Settings selects the exact transaction account. Choosing Auto selects Hosted
before new preparation; an explicit Venue choice for that same account stays
Venue. Already-authorized agent accounts can be selected with **Use for this
session**. This selection is session-local: select it again after a reload.
Network/auth refreshes preserve it; an actual wallet switch or disconnect clears
the prior account's route. Para's login address is never replaced implicitly
with a Para agent address.

The shared `ClientSession` boundary refreshes AccountProfile and resolves the
selected account with `UserState.route`. `route` only selects and never blocks
a turn: Auto with an active, unrevoked, unexpired delegation for that exact
address, chain, and provider defaults to Hosted; explicit selections are never
rewritten, including Manual Hosted/Venue; everything else is sent as-is.
EVM address comparison ignores case; SVM comparison does not. The backend commit
gate is what blocks (`signing_denied`, `broadcaster_incompatible`,
`broadcaster_unsupported_for_chain`), and it fires only when a transaction is
prepared, so a locked wallet or a missing delegation still lets the user chat.
Missing Auto capability blocks execution there; it never falls back to Manual.
An uncertain start retries the same complete intent and idempotency key.

`userState.evm.broadcaster` and `userState.svm.broadcaster` are optional values
`wallet | hosted | venue`, not authorization. Backend app policy bounds them.
Assembly freezes explicit selections and app defaults. Otherwise commit defaults
to Hosted for Auto or Wallet for Manual; it rejects Auto × Wallet and
unsupported adapters without changing authorizer, submitter, or payer.

## EVM routes available today

| Broadcaster × execution | Manual × UI                       | Manual × CLI                          | Auto × UI                 | Auto × CLI                |
| ----------------------- | --------------------------------- | ------------------------------------- | ------------------------- | ------------------------- |
| Wallet × no AA          | Wallet signs/submits              | Local key signs/submits               | Invalid; prepare Hosted   | Invalid; prepare Hosted   |
| Hosted × no AA          | Unsupported adapter               | Unsupported adapter                   | Provider signs/submits    | Provider signs/submits    |
| Venue × no AA           | Unsupported adapter               | Unsupported adapter                   | Unsupported adapter       | Unsupported adapter       |
| Wallet × AA             | Unsupported adapter               | Unsupported adapter                   | Invalid                   | Invalid                   |
| Hosted × AA             | Owner authorizes; backend submits | Owner key authorizes; backend submits | Server authorizes/submits | Server authorizes/submits |
| Venue × AA              | Unsupported adapter               | Unsupported adapter                   | Unsupported adapter       | Unsupported adapter       |

SVM sealing is not AA. Supported no-AA adapters additionally allow Manual Hosted
(supported app-bound instructions) and Manual/Auto Venue (with the venue adapter).
Clients preserve explicit Hosted/Venue selections under Manual. Signed bytes return
through the existing Action lifecycle, not Wallet submission.

## Client contract

- UI prompts only for Manual. Auto never returns a caller-signature prompt.
- CLI selects EVM with `--public-key` and SVM with `--solana-public-key`.
  Auto needs account authentication and delegation, not the selected wallet's
  private key. Manual requires a matching local key and supported adapter.
- CLI `--aa`/`--eoa` assert the prepared Action kind. They cannot change it;
  obsolete AA provider/mode overrides are rejected.
- Backend AA signatures use the supplied bytes exactly once. Funding is
  user-funded or sponsorship-required; application fees are separate from the
  maximum network cost. Ordinary backend transactions cannot acquire wallet-side
  AA or an injected paymaster at execution.
- Portable Pipeline V2 Builds retain origin, expiry, digest and attestation.
  Native action records are not a second wallet Action envelope.

Unit/component tests cover these boundaries. Real provider popups and funded
onchain execution are separate release gates, not implied by these tests.
