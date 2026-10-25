# @aomi-labs/service-identity

The TypeScript side of the AOMI service topology. One committed TOML describes
the mesh (`[[services]]` nodes with `name`, `kid`, `public_key`, `issues`,
`audiences`); a service selects its own node and gets an `AomiService` that
mints bearers as that identity and verifies bearers addressed to it.

It was extracted from `@aomi-labs/account/service-topology` so that the
Cloudflare edge (`apps/edge`, topology node `aomi-edge`) can mint every bearer
without pulling in the Node-only account package. `@aomi-labs/account` still
re-exports it from the old path.

Dependencies: `jose` (WebCrypto, so Node and Workers) and `toml`. The private
key is injected from the environment at construction time and never lives in
the TOML.
