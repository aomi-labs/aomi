---
title: Widget Frame
owner: frontend
status: authoritative
area: apps
review_after_days: 30
sources_of_truth:
  - apps/registry/src/components/aomi-frame.tsx
  - apps/registry/src/components/assistant-ui/thread.tsx
  - apps/registry/src/components/assistant-ui/threadlist-sidebar.tsx
  - apps/registry/src/components/control-bar/index.tsx
  - apps/registry/src/index.ts
---

# Widget Frame

`@aomi-labs/widget-lib` is the prebuilt UI surface for embedding Aomi as a React chat widget.

## Composition

- `AomiFrame` is the main compound component exported by the registry package.
- `AomiFrame.Root` mounts `AomiRuntimeProvider`, sidebar state, notification UI, auth-to-runtime sync, and the runtime transaction handler.
- `AomiFrame.Header` renders the current thread title plus `ControlBar`.
- `AomiFrame.Composer` renders the active thread view and can expose inline controls.

## Layout Behavior

- The default layout shows the thread list sidebar unless `showSidebar={false}` is passed.
- Wallet controls can live in the sidebar header, sidebar footer, or be hidden entirely.
- `backendUrl` falls back to `NEXT_PUBLIC_BACKEND_URL` and then `http://localhost:8080`.

## Supporting UI Surfaces

- Assistant UI primitives such as the thread list, message thread, and tool fallbacks live under `apps/registry/src/components/assistant-ui/`.
- The control surface lives under `apps/registry/src/components/control-bar/`.
- The registry package also exports themed CSS and individual component entrypoints for consumers that do not want the default frame layout.

## Related Topics

- [client-runtime/facts/react-runtime.md](../../client-runtime/facts/react-runtime.md)
- [auth/facts/wallet-kit.md](../../auth/facts/wallet-kit.md)
- [apps/facts/app-surfaces.md](../../apps/facts/app-surfaces.md)
