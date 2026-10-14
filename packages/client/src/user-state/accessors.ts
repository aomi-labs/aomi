import type { UserState } from "./index";
import { asRecord } from "../internal/record";
import { parseChainId } from "../wallet-utils";

type UnknownRecord = Record<string, unknown>;

function evmBlock(userState?: UserState | null): UnknownRecord | undefined {
  return asRecord(userState?.evm);
}
function svmBlock(userState?: UserState | null): UnknownRecord | undefined {
  return asRecord(userState?.svm);
}
function connBlock(userState?: UserState | null): UnknownRecord | undefined {
  return asRecord(userState?.connection);
}
export function address(userState?: UserState | null): string | undefined {
  const value = evmBlock(userState)?.address;
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export const evmAddress = address;

export function svmAddress(userState?: UserState | null): string | undefined {
  const value = svmBlock(userState)?.address;
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function chainId(userState?: UserState | null): number | undefined {
  return parseChainId(evmBlock(userState)?.chain_id);
}

export function ensName(userState?: UserState | null): string | undefined {
  const value = evmBlock(userState)?.ens_name;
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function isConnected(userState?: UserState | null): boolean | undefined {
  const value = connBlock(userState)?.is_connected;
  return typeof value === "boolean" ? value : undefined;
}

export function provider(
  userState?: UserState | null,
): string | null | undefined {
  const value = connBlock(userState)?.provider;
  if (value === null) return null;
  return typeof value === "string" ? value : undefined;
}

export function authMethod(
  userState?: UserState | null,
): string | null | undefined {
  const value = connBlock(userState)?.auth_method;
  if (value === null) return null;
  return typeof value === "string" ? value : undefined;
}

export function withExt(
  userState: UserState,
  key: string,
  value: unknown,
): UserState {
  const currentExt = asRecord(userState.ext) ?? {};

  return {
    ...userState,
    ext: {
      ...currentExt,
      [key]: value,
    },
  };
}
