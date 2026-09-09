export type AomiHttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export type AomiAuthClass =
  | "thread"
  | "account"
  | "agent_adapter"
  | "app_gate"
  | "delegated"
  | "service"
  | "admin"
  | "activation"
  | "activation-or-wallet"
  | "wallet"
  | "wallet-session";

export interface AomiEndpointSpec {
  method: AomiHttpMethod;
  path: string;
  auth: readonly AomiAuthClass[];
}

export { AOMI_BACKEND_ENDPOINTS } from "./generated/backend-routes";
