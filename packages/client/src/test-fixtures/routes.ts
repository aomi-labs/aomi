export type AomiHttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/** Every `x-aomi-auth` class the backend and manager document. */
export const AOMI_AUTH_CLASSES = [
  "public",
  "thread",
  "account",
  "agent_gate",
  "delegated",
  "service",
  "admin",
  "builder",
  "builder:read",
  "project:observe",
  "package:publish",
  "package:promote",
  "package:secrets",
  "agent:publish",
  "agent:promote",
] as const;

export type AomiAuthClass = (typeof AOMI_AUTH_CLASSES)[number];

export interface AomiEndpointSpec {
  method: AomiHttpMethod;
  path: string;
  auth: readonly AomiAuthClass[];
}

export { AOMI_BACKEND_ENDPOINTS } from "./backend-routes";
