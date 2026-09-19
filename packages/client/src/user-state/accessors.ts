import type {
  UserState,
} from "./index";

type UnknownRecord = Record<string, unknown>;

function asObject(value: unknown): UnknownRecord | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as UnknownRecord;
}

function evmBlock(userState?: UserState | null): UnknownRecord | undefined {
  return asObject(userState?.evm);
}
function svmBlock(userState?: UserState | null): UnknownRecord | undefined {
  return asObject(userState?.svm);
}
function connBlock(userState?: UserState | null): UnknownRecord | undefined {
  return asObject(userState?.connection);
}
function parseChainId(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = trimmed.startsWith("0x")
    ? Number.parseInt(trimmed.slice(2), 16)
    : Number.parseInt(trimmed, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
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
  const currentExt = asObject(userState.ext) ?? {};

  return {
    ...userState,
    ext: {
      ...currentExt,
      [key]: value,
    },
  };
}
