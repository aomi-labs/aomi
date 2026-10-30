# Guardrails and common mistakes

- **Package identity:** old embedded CLI and new standalone CLI use separate
  versions. Check installed commands and public availability; the client's
  migration message is not an installation test.
- **Funding:** inspect known operational positions before proposing a Safe.
  Wallet selection and address context do not grant signing authorization.
- **Commit identity:** use the full durable Commit ID and exact review. A chat
  response or an empty legacy Actions queue does not establish payment state.
- **Simulation:** read Commit review evidence. `tx simulate` is the legacy EVM
  Action branch; it is not a universal precondition command for current Commits.
- **Retry:** refresh the original session/Commit and reconcile hashes and wallet
  attempts first. A timeout is not proof that no transaction was sent.
- **Chain:** session `--chain` and signing RPC are independent; verify both
  against the prepared operation. Token symbols do not establish contract identity.
- **AA:** inspect the backend-prepared payload and fees; local flags constrain
  the expected type, not transform the transaction or guarantee sponsorship.
- **Credentials:** use the authorized signer without printing material. Run
  credential setup only on an explicit user request, explain where it persists
  or transmits, and keep values out of command logs and exported payment records.
- **Completion:** a signature is not submission; a source bridge receipt is not
  destination payment; only a `confirmed` Commit is a completed source-chain payment.
- **Guards:** preserve explicit user recipient intent and surface any simulation
  guard failures. A prompt rewrite or alternate app is not a remedy for a blocked
  review. See [drain-vectors.md](drain-vectors.md).

The host controls actual permission enforcement. The skill manifest documents
intended scope; it is not proof of sandboxing. Local CLI state can store keys and
bearers. Scope any inspection accordingly.
