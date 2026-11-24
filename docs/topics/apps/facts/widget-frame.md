---
title: Widget Frame
owner: frontend
status: authoritative
area: apps
review_after_days: 30
sources_of_truth:
  - packages/widget/src/frame/aomi-widget.tsx
  - packages/widget/src/frame/aomi-frame.tsx
  - packages/widget/src/thread/thread.tsx
  - packages/widget/src/sidebar/thread-list-sidebar.tsx
  - packages/widget/src/controls/index.tsx
  - packages/widget/src/host-composition.ts
  - apps/portal/src/components/shell/portal-aomi-frame.tsx
---

# Widget Frame

`@aomi-labs/widget` is the prebuilt UI surface for embedding Aomi as a
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
  `@aomi-labs/widget/host-composition`. It must not reach into private
  `packages/widget/src` paths.
- The Library (`packages/widget/src/library/`) lists package rows from
  `GET /api/account/packages` in groups: packages the thread's agent lists
  (always on), packages added with a code, other verified packages, and the
  rest. A row and its detail footer offer one first action: "Use in chat" (on),
  "Turn on" (off) or "Connect" (a required person key is missing). "Use in
  chat" closes the Library and asks the same frame's composer for the package's
  @ tag (`requestCapabilityMention`, private to that frame and dropped when the
  account or chat changes first); a Direct chat is only focused. A package
  added with a code has "Remove". Open sheets and confirms close when the
  account changes, and each write first reads `/api/account` and is not sent
  unless the account that started it is still signed in. Every change invalidates all of the account's
  `account-packages` reads, so "@" in any chat follows without a reload.
  Turning on a not verified package first shows its capability envelope once
  per device, keyed by backend, account, package id and envelope hash. The
  Wallet section names checked calls (`checked`) only for a verified package,
  and is left out for a package that declares nothing, which is no promise. Person keys are entered there; builder
  keys are only explained. "Add with code" (signed-in accounts;
  guests see a sign-in prompt) redeems a private package code through
  `POST /api/account/packages/activate`; the code is never stored. The package
  then turns on, a not verified one after its notice.
- `AomiWidget` embeds one agent: the `agent="publisher/name"` prop (default
  `aomi/main`) is the Direct target of every new thread, sent as `agent` in the
  start intent. A thread keeps its agent; `thread_agent_mismatch` shows a
  notice and is never retried with another agent. There is no agent
  picker and no `routing` prop.

## Layout Behavior

- The default layout shows the thread list sidebar unless `showSidebar={false}` is passed.
- Wallet controls can live in the sidebar header, sidebar footer, or be hidden entirely.
- The public widget receives its BFF `apiUrl` explicitly. Lower-level
  `AomiFrame` composition may use `backendUrl`.

## Supporting UI Surfaces

- Assistant UI primitives such as the thread list, message thread, and tool fallbacks live under `packages/widget/src/components/assistant-ui/`.
- The control surface lives under `packages/widget/src/components/control-bar/`.
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
