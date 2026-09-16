import * as accessors from "./accessors";
import type { components } from "../generated/agent-v1/types";

/**
 * Client-side user state synced with the backend.
 * Typically wallet connection info, but can be any key-value data.
 *
 * Account-abstraction and sponsorship are backend authority: they are resolved
 * by the `execution-profile` endpoint and per-execution operation payloads, and
 * are deliberately NOT part of this wire shape. The client never sends or stores
 * them here.
 */
type Schemas = components["schemas"];

export type UserState = Schemas["UserState"];
export type UserStateConnection = Schemas["UserStateConnection"];
export type UserStateEvm = Schemas["UserStateEvm"];
export type UserStateSvm = Schemas["UserStateSvm"];

/**
 * Known client surfaces that may want backend-specific UX strategies.
 * Additional string values are allowed for forward compatibility.
 */
export type AomiClientType = "ts_cli" | "web_ui" | (string & {});

export const CLIENT_TYPE_TS_CLI: AomiClientType = "ts_cli";
export const CLIENT_TYPE_WEB_UI: AomiClientType = "web_ui";

export namespace UserState {
  export const address = accessors.address;
  export const evmAddress = accessors.evmAddress;
  export const svmAddress = accessors.svmAddress;
  export const chainId = accessors.chainId;
  export const ensName = accessors.ensName;
  export const isConnected = accessors.isConnected;
  export const provider = accessors.provider;
  export const authMethod = accessors.authMethod;
  export const withExt = accessors.withExt;
}
