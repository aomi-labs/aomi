# Projects, packages, agents and channels

The manager owns Projects and their GitHub repository association. Build's
Edge routes resolve the caller before forwarding manager requests. The
server-side client is `@aomi-labs/internal`; its input and response contracts
come from `@aomi-labs/deploy`.

A package is an immutable WASI component release plus its manifest and slots.
An agent config selects package releases and chains. Publishing creates a
numbered release or config; promotion selects the live one. Builder keys carry
publisher-scoped capabilities, including package publishing, promotion and
secrets, or agent publishing and promotion.

Channels live under `channels` routes. A channel has one `agent` object and an
`agent_id`, with transport fields `kind` and `external_bot_id`. The object names
the agent by canonical `publisher/name` slug and includes its display name and
Project attribution.

Private agents use `Aomi-Agent-Key`. Builder agent-key reads and rotation live
under `builder/agents/:agent_id/agent-key`. Hosted MCP uses
`/v1/agents/:agent/mcp`, with the slug's slash percent-encoded.

The account package ships `agent-mcp-resources.sql` for the account database's
OAuth resource cutover. It copies resource policy, moves client links and
resource arrays, preserves opaque credentials, and refuses ambiguous old
names. The migration runs before the new routes serve traffic.
