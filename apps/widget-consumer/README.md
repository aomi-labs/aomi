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

## Routing controls

The widget defaults to Auto-only routing, so no app selector appears unless
the host opts into Direct. The host declares the allowed surface with the
`routing` prop:

```tsx
// Auto only: no mode or app selector.
<AomiWidget {...props} routing={{ targets: [{ mode: "auto" }] }} />

// One fixed Direct app: no selectors.
<AomiWidget
  {...props}
  routing={{ targets: [{ mode: "direct", apps: [{ app: "uniswap" }] }] }}
/>

// Auto plus one Direct app: Direct expands into a target dropdown.
<AomiWidget
  {...props}
  routing={{
    targets: [
      { mode: "auto" },
      { mode: "direct", apps: [{ applicationId: 2936682 }] },
    ],
  }}
/>

// Auto plus several Direct apps: Direct uses the same split target control.
<AomiWidget
  {...props}
  routing={{
    targets: [
      { mode: "auto" },
      {
        mode: "direct",
        apps: [{ app: "aave" }, { app: "uniswap" }],
      },
    ],
    defaultMode: "auto",
  }}
/>
```

`applicationId` on `AomiWidget` scopes widget authentication, catalogs, and
thread persistence; it does not by itself force Direct execution. In Auto,
`@` capability tags are model hints and never switch apps or chains. The tag
picker is keyboard-only (`@`) and is disabled in Direct because the selected
app is authoritative. When both modes are enabled, Direct presents its app
picker as the second segment of one execution-control capsule.
