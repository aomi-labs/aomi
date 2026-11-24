---
"@aomi-labs/client": minor
"@aomi-labs/widget": minor
"@aomi-labs/cli": minor
"@aomi-labs/account": minor
---

Policies are called policies everywhere, and need a backend that serves the `/policy` routes (product-mono#1905): deploy it first.

Client: `aomi.account.policy` calls `/v1/account/agent-wallets/:id/policy`, `.../policy/enforcement/:provider/:step`, `/v1/account/policy/catalog` and `/v1/account/policy-changes/:id` in place of the `/rules` paths. Wire field names and error codes (`rules`, `rules_changed`) stay as the backend sends them. An `AomiPolicyEnforcement` entry gains `next`: the kind of action `prepare` will ask the owner's wallet for (`transaction`, `typed_data`, `evm_transaction`), `null` when it asks for none, absent from an older backend. `expectedPolicyAction(entry, { remove, inForce })` reads it, answers `null` for no wallet action, and infers the kind from the signer only when `next` is absent or the call removes a policy still in force. `AomiPolicyChangeRequest` gains `revision`; `revise` sends the revision it read, so a concurrent edit is refused with `rules_changed` (still retried once) instead of overwritten. `matchPolicyIds(policies, typed)` lists the policy ids an id or the start of one names.

Account: the edge routes the `/policy` paths with the same requirements as the `/rules` ones, adds `POST /v1/account/agent-wallets/:id/policy/propose` for an `agent:write` grant, and keeps routing the `/rules` paths for clients on an older SDK. The routes' operation name is `account.policy`.

Widget: a policy's on-chain button is judged by `next`, so a step that needs no wallet action is no longer disabled for a wallet that cannot sign typed data. Settings › Policies saves each change with the revision it was built from. `SettingsModal` takes `policyFocus` (`PolicyFocus`, `{ wallet, policy? }`), which brings that wallet's policy row into view and marks it; the Portal passes it from `/?settings=policies&wallet=<agent wallet id>&policy=<policy id>`. Breaking, with no alias: in `@aomi-labs/widget/host-composition`, `RuleChangeCard`, `RuleChangePanel` and `RuleChangePanelProps` are `PolicyChangeCard`, `PolicyChangePanel` and `PolicyChangePanelProps`. The Portal serves a policy change at `/policy/<change id>`; `/rules/<change id>` redirects there.

CLI: a `<policy-id>` may be the start of an id; one that starts several fails and lists them. A policy's end prints its zone (`until 2026-12-22 UTC`). With no local key for the owner, `aomi policy deploy` and `undeploy` print the link to that policy in Settings › Policies, and a step that asks nothing of a wallet runs without a local key. A wallet authority signs at `/policy/<change id>`.
