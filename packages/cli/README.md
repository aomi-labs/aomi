# Aomi CLI

Install `@aomi-labs/cli` to use the `aomi` terminal command. The CLI depends on
the public `@aomi-labs/client` transport, account graph and conversation model.

```sh
npm install -g @aomi-labs/cli
aomi --help
aomi account login
aomi session list
```

`AOMI_BACKEND_URL` selects a Portal/BFF origin. The CLI defaults to
`https://chat.aomi.dev`. Account login creates a separate session lasting 24
hours. Local state lives under `~/.aomi` (`AOMI_STATE_DIR` overrides it).

The `aomi` bin shipped by `@aomi-labs/client` is retained for the migration
window. It bundles this implementation; new installations use this package.

### Updating running work

Interactive mode keeps one conversation open. Ordinary text updates its active
request; `/queue <text>` admits a separate request, and `/stop [turn-id]` cancels
active or selected queued work. A pending wallet approval still belongs to the
active request. Updates invalidate unsubmitted approvals and require a fresh
plan. The CLI prints `accepted` separately from `applied`.

For scripts, use an explicit target, revision and stable identity:

```sh
aomi chat "Use 5 instead" --intent steer --turn-id TURN --input-revision 1 --input-id INPUT
aomi chat "Research another token" --intent queue --input-id OTHER_INPUT
```

These operations print a JSON receipt and control snapshot. Reuse the input
identity on a retry. Unsupported hosts reject the operation; the CLI never
converts an update into a new send. If the target has finished, retain the text
and submit it explicitly as a new request.
