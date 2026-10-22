/**
 * Agent wallets the user manages: a name plus one hosted key per family,
 * created, renamed, paused, archived and restored from Settings, plus the
 * owner-only withdraw that works even while a wallet is paused or archived.
 *
 * Hand-written wire types for `/v1/account/agent-wallets` until the generated
 * client covers them:
 *   - `GET   /v1/account/agent-wallets`                   -> `AomiAgentWallets`
 *   - `POST  /v1/account/agent-wallets`                   -> `AomiAgentWallet`
 *   - `PATCH /v1/account/agent-wallets/:id`               -> `AomiAgentWallet`
 *   - `GET   /v1/account/agent-wallets/:id/balances`      -> `AomiAgentWalletBalances`
 *   - `POST  /v1/account/agent-wallets/:id/withdraw`      -> `{ ref }`
 * Writes are portal sessions only.
 */
import { asRecord, stringValue } from "../internal/record";
import type { AomiWalletFamily } from "../types";
import { laneOf, type AomiLane } from "./lanes";

/** The app that created a wallet and stays linked to it. */
export type AomiAgentWalletApp = { id: number; name: string; label: string };

/** One address of an agent wallet; `wallet_id` is the `w_` id of its key. */
export type AomiAgentWalletAddress = {
  family: AomiWalletFamily;
  address: string;
  wallet_id: string;
};

/** A connection with a lane set on the wallet. */
export type AomiAgentWalletConnection = {
  key: string;
  label: string;
  lane: AomiLane;
};

export type AomiAgentWallet = {
  /** The agent wallet id (a UUID). */
  id: string;
  name: string;
  paused: boolean;
  /** Unix seconds; archived wallets are hidden from chats and connections. */
  archived_at: number | null;
  /** The app that made it ("made in"); information only. */
  app: AomiAgentWalletApp | null;
  /** Unix seconds. */
  last_used_at: number | null;
  /** Unix seconds. */
  created_at: number;
  addresses: AomiAgentWalletAddress[];
  connections: AomiAgentWalletConnection[];
};

/**
 * Every agent wallet, archived ones included, most recently used first.
 * `pause_all` is the account-wide pause (`PUT /v1/account/pause-all`).
 */
export type AomiAgentWallets = {
  pause_all: boolean;
  wallets: AomiAgentWallet[];
};

export type AomiAgentWalletCreate = {
  name: string;
  families?: AomiWalletFamily[];
};

/** Omitted fields keep their value. */
export type AomiAgentWalletUpdate = {
  name?: string;
  paused?: boolean;
  archived?: boolean;
};

export type AomiAgentWalletAsset = {
  /** `native`, an ERC-20 address or an SPL mint. */
  token: string;
  symbol: string;
  decimals: number;
  amount: string;
  usd: string | null;
};

export type AomiAgentWalletNetwork = {
  /** An EVM chain id, or the Solana cluster name (`solana`). */
  chain_id: number | string;
  name: string;
  usd_total: string | null;
  assets: AomiAgentWalletAsset[];
  /** This network could not be read; the rest still are. */
  error: boolean;
};

/** Networks with funds first, then the empty ones. */
export type AomiAgentWalletBalances = { networks: AomiAgentWalletNetwork[] };

export type AomiAgentWalletWithdraw = {
  family: AomiWalletFamily;
  /** EVM only; a Solana withdraw leaves it out. */
  chain_id?: number;
  to: string;
  /** `amount` is a decimal string, or `max` (native keeps its gas). */
  assets: { token: string; amount: string }[];
};

export const agentWalletPaths = {
  list: "/v1/account/agent-wallets",
  wallet: (id: string) => `/v1/account/agent-wallets/${encodeURIComponent(id)}`,
  balances: (id: string) =>
    `/v1/account/agent-wallets/${encodeURIComponent(id)}/balances`,
  withdraw: (id: string) =>
    `/v1/account/agent-wallets/${encodeURIComponent(id)}/withdraw`,
} as const;

export function parseAgentWallets(value: unknown): AomiAgentWallets {
  const record = asRecord(value);
  if (!record) throw invalid("agent wallets must be an object");
  return {
    pause_all: record.pause_all === true,
    wallets: list(record.wallets, "wallets").map(parseAgentWallet),
  };
}

export function parseAgentWallet(value: unknown): AomiAgentWallet {
  const record = asRecord(value);
  if (!record) throw invalid("wallet must be an object");
  const app = asRecord(record.app);
  return {
    id: text(record.id, "wallet.id"),
    name: text(record.name, "wallet.name"),
    paused: record.paused === true,
    archived_at: unix(record.archived_at),
    app:
      app && typeof app.id === "number"
        ? {
            id: app.id,
            name: text(app.name, "app.name"),
            label: stringValue(app.label) ?? text(app.name, "app.name"),
          }
        : null,
    last_used_at: unix(record.last_used_at),
    created_at: unix(record.created_at) ?? 0,
    addresses: list(record.addresses, "addresses").map((entry) => {
      const address = asRecord(entry);
      return {
        family: family(address?.family),
        address: text(address?.address, "address.address"),
        wallet_id: text(address?.wallet_id, "address.wallet_id"),
      };
    }),
    connections: list(record.connections, "connections").map((entry) => {
      const connection = asRecord(entry);
      const key = text(connection?.key, "connection.key");
      return {
        key,
        label: stringValue(connection?.label) ?? key,
        lane: laneOf(connection?.lane),
      };
    }),
  };
}

export function parseAgentWalletBalances(
  value: unknown,
): AomiAgentWalletBalances {
  return {
    networks: list(asRecord(value)?.networks, "networks").map((entry) => {
      const network = asRecord(entry);
      const chainId =
        typeof network?.chain_id === "number"
          ? network.chain_id
          : stringValue(network?.chain_id);
      if (!network || chainId === undefined)
        throw invalid("network must carry a chain_id");
      return {
        chain_id: chainId,
        name: stringValue(network.name) ?? String(chainId),
        usd_total: stringValue(network.usd_total) ?? null,
        assets: list(network.assets, "assets").map((item) => {
          const asset = asRecord(item);
          return {
            token: text(asset?.token, "asset.token"),
            symbol: stringValue(asset?.symbol) ?? "",
            decimals: typeof asset?.decimals === "number" ? asset.decimals : 0,
            amount: stringValue(asset?.amount) ?? "0",
            usd: stringValue(asset?.usd) ?? null,
          };
        }),
        error: network.error === true,
      };
    }),
  };
}

function family(value: unknown): AomiWalletFamily {
  if (value === "evm" || value === "svm") return value;
  throw invalid(`unsupported family: ${String(value)}`);
}

function list(value: unknown, field: string): unknown[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw invalid(`${field} must be an array`);
  return value;
}

function text(value: unknown, field: string): string {
  const result = stringValue(value);
  if (result === undefined) throw invalid(`${field} must be a string`);
  return result;
}

const unix = (value: unknown) => (typeof value === "number" ? value : null);

function invalid(detail: string): TypeError {
  return new TypeError(`Invalid agent wallet response: ${detail}`);
}
