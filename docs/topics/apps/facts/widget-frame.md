---
title: Widget Frame
owner: frontend
status: authoritative
area: apps
review_after_days: 30
sources_of_truth:
  - apps/shadcn-registry/src/components/aomi-widget.tsx
  - apps/shadcn-registry/src/components/aomi-frame.tsx
  - apps/shadcn-registry/src/components/assistant-ui/thread.tsx
  - apps/shadcn-registry/src/components/assistant-ui/threadlist-sidebar.tsx
  - apps/shadcn-registry/src/components/control-bar/index.tsx
  - apps/shadcn-registry/src/host-composition.ts
  - apps/portal/src/components/shell/portal-aomi-frame.tsx
---

# Widget Frame

`@aomi-labs/widget-lib` is the prebuilt UI surface for embedding Aomi as a
React chat widget and for first-party host composition.

## Composition

- `AomiWidget` is the supported public integration. It owns wallet providers,
  widget authentication, transport configuration, and the default shell.
- `AomiFrame` is the lower-level compound component used for custom and
  first-party host composition.
- `AomiFrame.Root` mounts `AomiRuntimeProvider`, sidebar state, notification UI, auth-to-runtime sync, and the runtime transaction handler.
- `AomiFrame.Header` renders the current thread title plus `ControlBar`.
- `AomiFrame.Composer` renders the active thread view and can expose inline controls.
- Portal imports reusable account, settings, usage, and Library UI through
  `@aomi-labs/widget-lib/host-composition`. It must not reach into private
  `apps/shadcn-registry/src` paths.

## Layout Behavior

- The default layout shows the thread list sidebar unless `showSidebar={false}` is passed.
- Wallet controls can live in the sidebar header, sidebar footer, or be hidden entirely.
- The public widget receives its BFF `apiUrl` explicitly. Lower-level
  `AomiFrame` composition may use `backendUrl`.

## Supporting UI Surfaces

- Assistant UI primitives such as the thread list, message thread, and tool fallbacks live under `apps/shadcn-registry/src/components/assistant-ui/`.
- The control surface lives under `apps/shadcn-registry/src/components/control-bar/`.
- The registry package also exports themed CSS and individual component entrypoints for consumers that do not want the default frame layout.

## Host-specific policy

Shared UI does not mean identical host policy. Portal integrates first-party
cookies, URL handoffs, BFF routes, and cookie-owned guest recovery. The public
cross-origin widget establishes an origin-bound widget session and does not
persist an anonymous guest thread by default. Keep those policies with their
hosts while reusing the same presentation and interaction implementation.

## Related Topics

- [client-runtime/facts/react-runtime.md](../../client-runtime/facts/react-runtime.md)
- [auth/facts/wallet-kit.md](../../auth/facts/wallet-kit.md)
- [apps/facts/app-surfaces.md](../../apps/facts/app-surfaces.md)
