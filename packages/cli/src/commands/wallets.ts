import type { AomiAccountWallet } from "@aomi-labs/client";
import { privateKeyToAccount } from "viem/accounts";
import { connect, json, out, usage, type ConnectFlags } from "../context";
import { loadState, updateState, type SvmCluster } from "../state";

type Flags = ConnectFlags & { json?: boolean };
const solana = async () =>
  (await import("@aomi-labs/client/solana")).solanaSigner;

function table(rows: string[][]): string[] {
  const widths = rows[0]!.map((_, column) =>
    Math.max(...rows.map((row) => row[column]!.length)),
  );
  return rows.map((row) =>
    row
      .map((cell, column) => cell.padEnd(widths[column]!))
      .join("  ")
      .trimEnd(),
  );
}

/** `aomi wallets`: the account's wallets, agent wallets first. */
export async function list(flags: Flags): Promise<void> {
  const aomi = await connect(flags);
  const wallets: AomiAccountWallet[] = await aomi.account.wallets.list();
  if (flags.json) return wallets.forEach(json);
  if (!wallets.length) return out("No wallets yet");
  table([
    ["ID", "KIND", "FAMILY", "ADDRESS", "NAME", "LANE"],
    ...wallets.map((wallet) => [
      wallet.id,
      wallet.kind,
      wallet.family,
      wallet.address,
      wallet.label,
      wallet.lane ?? "",
    ]),
  ]).forEach((line) => out(line));
}

export async function balance(flags: Flags, id: string): Promise<void> {
  const aomi = await connect(flags);
  const { networks } = await aomi.account.wallets.balance(id);
  if (flags.json) return networks.forEach(json);
  for (const network of networks) {
    if (network.error) {
      out(`${network.name}  unavailable`);
      continue;
    }
    for (const asset of network.assets)
      out(
        `${network.name}  ${asset.amount} ${asset.symbol}${asset.usd ? `  $${asset.usd}` : ""}`,
      );
  }
}

/** Make `id` the wallet the current thread trades with. */
export async function use(flags: Flags, id: string): Promise<void> {
  const aomi = await connect(flags);
  const thread = loadState().thread ?? crypto.randomUUID();
  const result = await aomi.raw.account.wallets.setThreadWallet(thread, id);
  updateState({ thread });
  if (flags.json) return json(result);
  out(`Using ${id} in thread ${thread}`);
}

/** This machine's own keys, which sign what the agent prepares. */
export async function signer(flags: Flags): Promise<void> {
  const state = loadState();
  const evm = state.evmKey
    ? privateKeyToAccount(state.evmKey as `0x${string}`).address
    : undefined;
  const svm = state.svmKey ? (await solana())(state.svmKey).address : undefined;
  if (flags.json) return json({ evm, svm, cluster: state.cluster });
  if (!evm && !svm)
    return out("No local signer; aomi wallets signer set <key>");
  if (evm) out(`EVM     ${evm}`);
  if (svm) out(`Solana  ${svm} (${state.cluster ?? "solana:mainnet"})`);
}

const CLUSTERS: Record<string, SvmCluster> = {
  mainnet: "solana:mainnet",
  "mainnet-beta": "solana:mainnet",
  devnet: "solana:devnet",
  testnet: "solana:testnet",
};

export async function setSigner(
  flags: Flags & { solana?: string; cluster?: string },
  evm?: string,
): Promise<void> {
  if (!evm && !flags.solana) throw usage("Pass an EVM key, or --solana <key>");
  const cluster = flags.cluster
    ? (CLUSTERS[flags.cluster.replace(/^solana:/, "")] ??
      (() => {
        throw usage(
          `Unknown cluster ${flags.cluster}; use mainnet, devnet or testnet`,
        );
      })())
    : undefined;
  if (evm && !/^0x[0-9a-fA-F]{64}$/.test(evm))
    throw usage("The EVM key must be 0x-prefixed 32-byte hex");
  if (flags.solana) (await solana())(flags.solana);
  updateState({
    ...(evm ? { evmKey: evm } : {}),
    ...(flags.solana ? { svmKey: flags.solana } : {}),
    ...(cluster ? { cluster } : {}),
  });
  await signer(flags);
}

export async function clearSigner(): Promise<void> {
  updateState({ evmKey: undefined, svmKey: undefined, cluster: undefined });
  out("Local signer removed");
}
