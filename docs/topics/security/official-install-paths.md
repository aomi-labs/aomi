---
title: Official Aomi install paths
description: Install Aomi packages and skills from their official sources.
---

# Official Aomi install paths

Use the exact package names and repository links below when you install Aomi.
A similar name does not establish that a package is published by Aomi Labs.

## Packages

- Widget: `npm install @aomi-labs/widget react react-dom`
- Headless library: `npm install @aomi-labs/react`
- TypeScript client: `npm install @aomi-labs/client`
- CLI: `npm install -g @aomi-labs/cli`

See the [source repository](https://github.com/aomi-labs/aomi) for package documentation.

## Skills

Install skills from the [Aomi skills repository](https://github.com/aomi-labs/skills):

```sh
npx skills add aomi-labs/skills
```

`aomi-labs/skills` identifies the GitHub repository, not an npm package.

## Hosted MCP

- Agent: `https://chat.aomi.dev/v1/agent/mcp`
- Pipeline: `https://chat.aomi.dev/v1/pipeline/mcp`

Copy these URLs exactly when you configure your MCP client.
