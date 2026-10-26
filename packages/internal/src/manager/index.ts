// The manager (Aomi platform control plane) client: projects, attempts,
// deployments, releases, bots, model keys, usage, logs and statements. Moved
// here from @aomi-labs/deploy so the edge Worker and the Build BFF call the
// manager through one typed surface that is never published.
export { BackendClient, BackendClient as ManagerClient } from "./user";
export { assertServerOnly } from "./core";
export * from "./bff";
