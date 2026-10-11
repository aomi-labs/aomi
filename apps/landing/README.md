# Aomi Landing and Documentation

Landing hosts the public marketing site, research, agent guides, widget examples,
and playground. It uses TanStack Start, Router, and Query with Vite and Nitro;
Fumadocs supplies the MDX pipeline and documentation UI.

All four deployed apps use Vite **8.3.4**. Landing pins `fumadocs-mdx` **14.3.2**,
whose Vite plugin declares peer support for Vite 6, 7, and 8. Next.js remains in
the protected consumer and published compatibility/theme utilities.

## Development and builds

Use an official Node.js 22.15+ or 24 runtime and the repository-pinned pnpm through
Corepack. Install, build, and full-test commands run through the selected managed
Aomi workspace. These are the app commands from the repository root:

```sh
pnpm --filter landing dev         # Vite on PORT, default 3000
pnpm --filter landing type-check  # Generate MDX and routes, then check types
pnpm --filter landing lint
pnpm --filter landing test
pnpm --filter landing build       # Build package prerequisites and the host
pnpm --filter landing build:app   # Host only when prerequisites are ready
pnpm --filter landing start       # Run the Node production artifact
```

For example, submit a build with:

```sh
aomi-dev exec --repo frontend <workspace> -- pnpm --filter landing build
```

The Node preset produces `.output/server/index.mjs` and `.output/public`.
`VERCEL=1` selects Nitro's Vercel Build Output API preset. `vercel.json` clears
Next framework/output overrides. Building a Node artifact does not verify a
hosted Vercel deployment.

## Host boundaries

- `src/routes` owns native page and HTTP bindings; `src/routeTree.gen.ts` is generated.
- `src/screens` owns the app's presentation and layouts.
- `src/server` owns HTTP handlers, content/assets preparation, and upstream calls.
- `/` serves the committed marketing HTML and assets. The immutable pre-migration
  inventory contains 24 pages and 15 explicit HTTP bindings, including that root handler.
- `/examples` and `/playground` render Fumadocs MDX. `/docs`, Mintlify assets, and
  the docs API bridge retain their existing upstream proxy contracts.
- Markdown, registry, research data, robots/sitemap, API proxy, and OpenGraph
  endpoints remain ordinary HTTP routes. Native method defaults and 308
  canonical-path redirects run before dispatch.

Each router owns one QueryClient and its provider. SSR dehydration includes only
successful queries explicitly marked `ssrSafe`; private queries and mutations
stay out. Existing widget and wallet providers keep their authentication and
Action ownership. Browser-dependent providers and playground code use client
boundaries rather than server-side wallet identity.

Public environment names remain compatible. Vite exposes only the keys listed
in [public-env.keys.json](./public-env.keys.json); server credentials stay in
server code. Set public configuration before building, and keep `.env` files
out of version control.

## Editing MDX

`source.config.ts` defines collections in `content/guides`, `content/examples`,
and `content/playground`. The `fumadocs-mdx/vite` integration generates `.source`
during postinstall; `type-check` regenerates it before checking native routes.
Do not edit `.source` or generated route files.

Add a page to the appropriate collection with frontmatter:

```mdx
---
title: Your Page Title
description: Your page description
---

# Your Page Title

Your content here.
```

Keep each directory's `meta.json` navigation order current. Shared MDX component
registration lives in `src/screens/mdx-components.tsx`, and collection loaders
live in `src/lib/source.tsx`. Code blocks, tabs, callouts, Mermaid, and Twoslash
remain configured through the existing Fumadocs pipeline.

## Verification

Follow [the four-app migration procedure](../../docs/testing/tanstack-migration.md)
for immutable route parity, copied Node/Vercel artifacts, public asset hashes,
proxy and metadata contracts, and the protected packed-consumer/browser gates.
Evidence from the earlier Portal/Build-only migration does not establish this
host's readiness. Provider sign-in and a hosted deployment require their own
verification.
