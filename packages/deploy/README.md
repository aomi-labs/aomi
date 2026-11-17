# @aomi-labs/deploy

Shared TypeScript contracts for the Build control plane. The package owns
response schemas, input types, deployment lifecycle presentation and errors.
The server-side `ManagerClient` lives in `@aomi-labs/internal`.

Packages publish immutable numbered releases. Agents publish numbered configs
that select package releases and chains. Promotion moves the live pointer to a
published release or config. A channel binds one agent; its transport identity
is `kind` and `external_bot_id`.

The CLI exposes package and agent publishing through `aomi release`. Package
secrets belong to their package slots; secret values never appear in read
responses. See [the project facts](../../docs/topics/deploy/facts/projects.md)
for ownership and routing.
