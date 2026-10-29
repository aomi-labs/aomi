// The manager (Aomi platform control plane) client: projects, attempts,
// deployments, releases, bots, model keys, usage, logs and statements, one
// row each in ENDPOINTS. The edge Worker and the CLIs call the manager
// through this one typed surface, which is never published.
export { ManagerClient, assertServerOnly, type ManagerClientOptions } from "./client";
export { ENDPOINTS } from "./endpoints";
export * from "./bff";
