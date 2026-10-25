# Portal account choice

The shared widget OAuth bootstrap previews server-verified canonical accounts
before accepting a choice. This is account switching, never account merging.

- Signed out: confirm the incoming app account to create a portal session.
- Same canonical account: preserve the existing portal session.
- Different accounts: choose the app account for the portal, or continue the
  authorization as the existing portal account.
- Cancel: no ticket redemption and no session changes.

`POST /api/auth/aomi/widget-bootstrap/preview` accepts the existing ticket,
origin, state and channel nonce. It does not consume the ticket. Its no-store
response contains `widget`, `portal` (nullable), and `sessionVersion` (nullable).
Account labels and canonical IDs are resolved on the server.

`POST /api/auth/aomi/widget-bootstrap/redeem` requires the same binding plus
`confirmed: true`, `account: "widget" | "portal"`, and the preview's
`sessionVersion`. It rechecks the live portal session, originating widget session,
identity and managed-client policy before atomically consuming the ticket.
Changed sessions fail with `portal_session_changed`; the user must restart.
Expiry, replay and revoked bindings fail closed. Keeping the portal account does
not relink the incoming wallet, alter a balance or create another portal session.

The existing OAuth authorization/consent and PKCE/DPoP exchange still follow this
choice. This patch does not turn an OAuth grant into a Fuzzer account session or
implement portal-only navigation. Hosts must adopt the selected authenticated
principal, clear their prior account's transport/cache state, and scope saved
campaigns to their original canonical owner. They must never resume the prior
account's campaign under the new account. A connected signing wallet is separate
from the selected Aomi account. In particular, the current SDK grant-manager
`subject` is a caller-provided cache partition, not proof of the selected account;
hosts must not use it to infer the authenticated principal after switching.

Deploy the Portal page and shared account package together: redemption now
requires an explicit choice and preview. Stale open pages fail safely and must
reopen the handoff. No database migration, payment writer, account merge or
production configuration is changed.

Local verification: 18 shared-auth tests and 7 rendered Portal component tests
cover both choices, signed-out and matching sessions, cancellation, origin/window
binding, revocation, one-time consumption and session changes during confirmation.
Browser-provider integration and the actual Fuzzer account transition remain
separate acceptance checks; mocked tests do not establish those outcomes.

Shared package builds, Portal and account type checks, frontend boundary checks,
and isolated SDK consumer compatibility checks also passed.
