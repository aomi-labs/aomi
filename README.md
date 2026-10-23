# Aomi

An execution harness for onchain finance. You describe what you want, Aomi simulates it, your wallet signs it, and it's non-custodial.

| Package | Purpose |
| --- | --- |
| `@aomi-labs/react` | Headless conversation runtime |
| `@aomi-labs/client` | Browser and Node transport, accounts and SDK |
| `@aomi-labs/widget-lib` | Chat UI and browser wallet integration |

## MCP Server

Connect Aomi to Claude, Cursor, or any MCP client.

```sh
claude mcp add https://chat.aomi.dev/v1/agent/mcp
```

Or add to your MCP settings manually:

```json
{
  "mcpServers": {
    "aomi": {
      "url": "https://chat.aomi.dev/v1/agent/mcp"
    }
  }
}
```

Read prices, balances, build transactions, simulate them on a forked chain, and sign locally through your wallet.

### Publishing to the MCP Registry

The `server.json` file in this repo contains the MCP server metadata for the official registry. To publish or update:

1. Fork the [MCP registry](https://github.com/modelcontextprotocol/registry)
2. Add or update `registry/src/servers/io.github.aomi-labs/aomi/server.json` with the contents from this repo
3. Submit a pull request

The server is also available on Smithery, Glama, and other MCP directories.

## CLI

```sh
npm install -g @aomi-labs/client
aomi --help
```

The `aomi` command is included in the `@aomi-labs/client` package. If not on PATH, use `npx @aomi-labs/client` instead.

```sh
aomi --prompt "what is the price of ETH?"
aomi tx build "swap 1 ETH for USDC"
aomi tx simulate tx-1
aomi tx sign tx-1
```

## React Widget

Drop a working AI chat widget into your app with simulation and wallet signing already wired.

```sh
npm install @aomi-labs/widget-lib react react-dom
```

```tsx
import { AomiWidget } from "@aomi-labs/widget-lib";
import "@aomi-labs/widget-lib/styles.css";

export function Assistant() {
  return <AomiWidget applicationId="2937810" />;
}
```

The default API origin is `https://chat.aomi.dev`. Browser wallets are the default authentication mode.

## Headless React

For custom UIs, install `@aomi-labs/react` and provide the transport and wallet capabilities explicitly.

```sh
npm install @aomi-labs/react @aomi-labs/client
```

See the package READMEs and the [integration documentation](https://aomi.dev/docs).

See [official install paths](docs/topics/security/official-install-paths.md) for package names, skills installation, and hosted MCP URLs.

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
