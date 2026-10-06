# Aomi

Aomi provides a React chat widget, a headless React runtime, a TypeScript SDK
and a terminal client for conversations and wallet actions.

| Package | Purpose |
| --- | --- |
| `@aomi-labs/widget` | Chat UI and browser wallet integration |
| `@aomi-labs/react` | Headless conversation runtime |
| `@aomi-labs/client` | Browser and Node transport, accounts and Pipeline SDK |
| `@aomi-labs/cli` | The `aomi` terminal command |

## Widget

```sh
npm install @aomi-labs/widget react react-dom
```

```tsx
import { AomiWidget } from "@aomi-labs/widget";
import "@aomi-labs/widget/styles.css";

export function Assistant() {
  return <AomiWidget applicationId="2937810" />;
}
```

The default API origin is `https://chat.aomi.dev`; pass `apiUrl` for another
Portal/BFF. Browser wallets are the default authentication mode. Optional
Privy and Para integrations load when selected and require their SDK packages.
The widget scopes its styles, overlays and preferences to each instance.

Advanced hosts compose the compiled `@aomi-labs/widget/frame` entry and supply
an explicit `backendUrl`. `@aomi-labs/widget-lib` remains a deprecated
compatibility package during the migration window. The frozen copy-in
registry remains available for one release; see
[registry transition](docs/topics/development/facts/registry-retirement.md).

## SDK and CLI

```sh
npm install @aomi-labs/client
npm install -g @aomi-labs/cli
aomi --help
```

The CLI shares the public SDK's conversation, account, guard and Pipeline
contracts. `aomi session list` reads remote conversations; `local-list` reads
local CLI state. Rename and archive, edit and rerun, guard revision checks and
account statements use the same backend authority as the widget.

For custom React UIs, install `@aomi-labs/react` and provide the transport and
wallet capabilities explicitly. See the package READMEs and the maintained
[integration documentation](https://docs.aomi.dev).

## Workspace

`apps/` contains deployed hosts: Portal, Build, Landing and Telegram.
`examples/` contains Vite, Next.js and headless integrations. Shared code lives
under `packages/`. Build owns the deployment UI; Portal retains its supported
API routes and redirects deployment navigation to Build.

Use the pinned pnpm version and the managed local workflow:

```sh
pnpm install --frozen-lockfile
aomi-dev up
aomi-dev exec --repo frontend -- pnpm check
aomi-dev exec --repo frontend -- pnpm run test:contracts -- --base <trusted-sha>
```

Read [frontend invariants](docs/topics/development/facts/frontend-invariants.md)
and [AGENTS.md](AGENTS.md) before changing packages or consumers. Library
configuration comes from props; secrets belong in server configuration or
explicit credential providers.

## License

MIT
