# Troubleshooting

| Symptom | Investigation and next action |
| --- | --- |
| Guest sign-in HTTP 404 | Read `aomi config current --json`. Match sanitized origin and source to the failed guest endpoint. The Portal host is `chat.aomi.dev` (staging `chat-staging.aomi.dev`); a direct `api.*` backend origin cannot serve guest login. Fix the winning CLI override in its owning shell/session configuration. |
| Standalone package npm E404 | Release/install blocker. Preserve the working binary; source success or a migration shim is not proof the replacement is publicly installable. |
| Missing Commit/payment command | Check installed binary and `tx --help`; report the required package capability. Avoid automatic global upgrades or comparing standalone and legacy embedded version numbers. |
| No legacy Action after chat | Refresh `tx list --json` and inspect Commits. An agent can also have returned a quote or clarification rather than preparing execution. |
| Insufficient destination token | Inspect other known operational chains/assets and fresh route minimum output/fees before considering treasury funding. |
| Native gas shortfall | Show the precise chain and gas requirement; token balance does not pay ordinary EOA gas. Inspect prepared AA fees separately. |
| Timeout after signing/submitting | Resume the same session, refresh the same Commit, reconcile known hash and wallet attempt. Keep a single payment record. |
| Commit submitted, not confirmed | Refresh `tx list --json`; the backend observes the receipt. Inspect the hash on a chain-matching RPC before concluding anything. |
| Bridge source confirmed | Inspect destination receipt and spendable output token; continue the same route record. |
| Swap, AA, batch or bridge completion | These need their own execution/destination evidence. Preserve the Commit/hash while reconciling that flow. |

Errors should identify effective origin, configuration source and failed endpoint
without exposing URL credentials, bearer tokens or upstream bodies. If a setting
serves both CLI and direct backend tools, localize the CLI override rather than
changing every consumer's host.
