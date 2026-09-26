---
title: Transaction safety controls
owner: frontend
status: authoritative
area: development
review_after_days: 30
sources_of_truth:
  - packages/client/src/transaction-safety.ts
  - packages/client/src/commit-lifecycle.ts
  - apps/shadcn-registry/src/components/account-shell/features/policy/transaction-safety-settings.tsx
---

# Transaction safety controls

Transaction safety is separate from on-chain permissions and signing grants.
Policy settings compose a server-backed safety selector above the existing Swig
form; safety loading does not require a Solana wallet or Swig binding. Swig's
prepare, confirm and revoke calls are unchanged.

The authenticated `transactionSafety` SDK namespace reads and updates the
account default and owned thread selection. Writes carry `expectedRevision`;
responses are schema-validated and the UI waits for the authoritative reply.
Guarded only (`guarded_only`) and Balanced (`balanced`) can be account defaults.
Danger mode (`unrestricted`) is a thread selection and requires one enablement
confirmation. Updating an account default does not alter existing chats.

Runtime integrations may expose `transactionSafety` through `AomiRuntimeApi`.
Older custom runtimes can omit this optional member. Transaction safety adds UI
only in Settings → Policy. The activity sidebar, transaction cards, simulation
panel and Submit controls keep their existing layout, icons and labels. Cards
retain their fixed 84px height; there is no sidebar mode badge or assessment row.

Reviews consume the authoritative server eligibility while legacy requests
preserve their existing simulation/guard handling. Existing wallet attempts use
the normal reconciliation path before any new-eligibility check. Changing a mode
cannot create another Submit for an uncertain attempt. Ordered Submit all checks
the remaining cohort and stops when any leg is blocked, stale or unavailable.

Implementation tests and generated contracts are local evidence. Browser,
real-provider signing, restart and Luna qualification coverage must be reported
separately; this document does not claim those integrations passed.

Standalone EVM Pipeline and Task build requests accept the optional top-level
`transactionSafetyMode` (`guarded_only`, `balanced`, or `unrestricted`). Initial
requests that omit it use Balanced. This API selection is independent of the chat
preference. Portable EVM Builds seal their selected mode; a later simulate or
commit request that omits the field inherits the carried mode (legacy Builds
without a field use Balanced). An explicit later override requires a fresh
assessment and review. Existing invoked attempts reconcile their original
identity and are not rewritten by a mode selection.

The EVM SDK accepts the mode on build/stage input and mutation options. The API
may separately authorize limited guard coverage through a signed permission.
Its additional UI controls are deferred; the signing settings keep their
original form. Saving a chat safety setting never expands that signing grant.

ExecuteEvm Actions may carry server-authored ordered `commitStages`. The SDK
resolves those exact stage references against canonical session CommitViews and
uses the existing Commit Service controller. Missing views require refresh;
they never cause a direct wallet send. The original Action identity remains in
the activity trace, and its linked CommitViews share the same cards. Terminal
cohort delivery completes the original Action once.

The authorization API can explicitly request per-execution signed limits for
network IDs, recipient addresses, native value in wei and token amounts in raw
units. Omitted limits remain unrestricted. Limits are part of the immutable
wallet authorization payload; the reviewed challenge must echo the requested
limits. Removing or widening limits requires a new wallet authorization.
These caps apply to each submitted transaction group and include all its legs.
Token limits sum direct transfer amounts and newly authorized approval amounts;
a transfer and an approval each contribute their full raw amount. Native limits
sum transaction values across the group.
They do not track cumulative spending across separate submissions.
Recipient restrictions include approval spenders. A material effect whose
compliance with an explicit restriction cannot be proven remains blocked in
every safety mode.
The backend supplies EIP-712 typed data, including the version 3 constraints
hash; the frontend signs that exact reviewed payload.

Portable Builds may include server-authored `guardEvidence`. SDK mutation calls
carry this evidence unchanged with the sealed Build. Provider provenance alone
does not establish protocol coverage of opaque nested calldata.

Public EVM Pipeline commit preparation also returns its original `actions`,
canonical `commits` and owned `thread_id`. Use
`aomi.pipeline.evm.commits(preparation, capabilities)` to open the existing
Commit controller, then explicitly execute, reject or refresh the selected
commit. Close the controller when finished. It uses the public
`/v1/pipeline/evm/commits` continuation routes with `pipeline:execute` scope.
That scope only accesses saved standalone Pipeline cohorts owned by the caller;
it does not grant access to chat commits. Incomplete or mismatched cohort
references fail before wallet invocation. The generic wallet capability rejects
requests carrying durable stage references.

The preparation response's `provider_invoked: false` describes that endpoint
call. Returned CommitViews show the actual saved cohort state, including any
previously invoked attempt on replay. A retry returns the original Action and
cohort references before fresh simulation or review; it does not create a new
wallet invocation.

Ordinary manual EVM message-signing execution Actions are currently unavailable:
the Action result protocol has no durable pre-signature admission claim. The
client disables Submit and refuses wallet execution or a newly signed result;
the server rejects new requests before opening an approval and also refuses
newly signed legacy pending results. Existing completed-result reconciliation,
account authorization consent, hosted Auto signing under its existing admission
locks, and excluded AA/SVM signing keep their existing paths.
