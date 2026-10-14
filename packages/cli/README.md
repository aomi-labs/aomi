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
