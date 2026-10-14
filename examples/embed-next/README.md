# Next.js embed

This example uses the published widget entry and scoped stylesheet in an ordinary Next.js client component. Browser wallet authentication needs no provider key or host provider wrapper.

From the workspace, run `pnpm install`, `pnpm --filter @aomi-labs/widget build`, and `pnpm --filter @aomi-labs/example-embed-next dev`. Open http://localhost:3003.

For a standalone copy, replace `workspace:*` with `^3.1.0` and run `pnpm install`. Set the public backend URL and application ID in `.env.local` using `.env.example`. No private credential belongs in a `NEXT_PUBLIC_` variable. If using your own backend, allow the embed origin in its widget origin configuration.

`pnpm build` verifies the production SSR build. The widget runs in the client component; the layout imports its stylesheet once.
