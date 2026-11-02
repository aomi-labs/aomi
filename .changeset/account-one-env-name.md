---
"@aomi-labs/account": minor
---

One name and one reader per env var. `readAccountAuthEnv` reads `PRIVY_APP_ID`, `PRIVY_IDENTITY_JWT_VERIFICATION_KEY`, `PARA_JWT_AUDIENCE` and `BETTER_AUTH_URL` only, with no `NEXT_PUBLIC_*` or alias fallbacks. `backendUrlFromEnv` reads `BACKEND_URL` only and throws on Vercel when it is missing. SIWE smart-wallet checks no longer carry a committed Alchemy key: without `ALCHEMY_API_KEY` they use each chain's public RPC. The MCP DPoP switch is the committed `MCP_DPOP_REQUIRED` constant in `@aomi-labs/account/policy`, shared with the edge; `isMcpDpopRequired` and `AOMI_MCP_DPOP_REQUIRED` are removed.
