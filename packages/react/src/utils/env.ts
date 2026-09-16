/**
 * Read an environment variable defensively.
 *
 * Re-exported from `@aomi-labs/client` so there is a single implementation
 * across the two packages. See `packages/client/src/internal/env.ts` for the
 * rationale (bundlers inline `process.env.X`; the thunk tolerates a missing
 * `process` in pure-browser builds).
 */
export { safeEnv } from "@aomi-labs/client";
