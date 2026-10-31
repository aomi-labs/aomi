// `@aomi-labs/account`: the server side of Aomi sign-in. It finds or creates
// the Aomi account for a Better Auth session and holds the database pool the
// edge opens per request. Server-only: never import it in a browser.

export { currentPool, getPool, withDatabase } from "./db/pool";

export * from "./types";
