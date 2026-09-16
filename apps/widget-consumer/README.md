# Aomi widget consumer

Standalone Vite consumer used to exercise the published widget boundary and
real browser CORS behavior. It runs at `http://localhost:3001` while Portal runs
at `http://localhost:3000`; authentication uses an origin-bound widget session
token and never depends on Portal cookies.

```sh
pnpm --filter widget-consumer dev
```

Copy `.env.example` to `.env.local` and use a Para project key whose allowed
origins include `http://localhost:3001`. The checked-in example contains no
credential. Local `.env.local` is ignored by Git.
