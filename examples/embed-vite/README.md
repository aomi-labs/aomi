# Aomi widget consumer

Standalone Vite consumer used to exercise the published widget boundary and
real browser CORS behavior. It runs at `http://localhost:3001` while Portal runs
at `http://localhost:3000`; authentication uses an origin-bound widget session
token and never depends on Portal cookies.

CI also extracts this fixture from the immutable PR base, installs candidate
package tarballs into it outside the monorepo, production-builds it, and drives
its guest and wallet-authenticated CORS contracts in Chromium. A PR therefore
cannot make a package break pass by editing this consumer at the same time.

```sh
pnpm --filter widget-consumer dev
```

Copy `.env.example` to `.env.local` and use a Para project key whose allowed
origins include `http://localhost:3001`. The checked-in example contains no
credential. Local `.env.local` is ignored by Git.

## One agent per widget

`agent="publisher/name"` on `AomiWidget` names the one agent the widget talks
to (default `aomi/main`). Every new thread is created for it and keeps it;
a thread of another agent is refused with `thread_agent_mismatch` and the widget
says so. There is no agent or app picker. `@` capability tags stay model hints.
