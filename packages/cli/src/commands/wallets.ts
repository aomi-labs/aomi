import type { AomiAccountWallet } from "@aomi-labs/client";
import bs58 from "bs58";
import { isAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  connect,
  json,
  out,
  table,
  usage,
  type ConnectFlags,
} from "../context";
import { loadState, updateState } from "../state";

type Flags = ConnectFlags & { json?: boolean };
const solana = async () =>
  (await import("@aomi-labs/client/solana")).solanaSigner;

/** How a wallet signs what the agent prepares, in a few words. */
export function signsWith(wallet: AomiAccountWallet): string {
  if (wallet.kind !== "agent") {
    const app = wallet.browser_app ?? wallet.provider ?? wallet.label;
    return `you sign in ${app.charAt(0).toUpperCase()}${app.slice(1)}`;
  }
  if (wallet.ask_mode === "instant") return "signs at once";
  return wallet.ask_mode === "ask_client"
    ? "you approve here"
    : "you approve on Aomi";
}

/** `aomi wallets`: the account's wallets, agent wallets first. */
export async function list(flags: Flags): Promise<void> {
  const aomi = await connect(flags);
  const wallets: AomiAccountWallet[] = await aomi.account.wallets.list();
  if (flags.json) return wallets.forEach(json);
  if (!wallets.length) return out("No wallets yet");
  table([
    ["ID", "NAME", "FAMILY", "ADDRESS", "SIGNS"],
    ...wallets.map((wallet) => [
      wallet.id,
      wallet.label,
      wallet.family,
      wallet.address,
      signsWith(wallet),
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
  const result = await aomi.account.wallets.use(id, { thread });
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

export async function setSigner(
  flags: Flags & { solana?: string },
  evm?: string,
): Promise<void> {
  if (!evm && !flags.solana) throw usage("Pass an EVM key, or --solana <key>");
  if (evm && !/^0x[0-9a-fA-F]{64}$/.test(evm))
    throw usage("The EVM key must be 0x-prefixed 32-byte hex");
  if (flags.solana) (await solana())(flags.solana);
  updateState({
    ...(evm ? { evmKey: evm } : {}),
    ...(flags.solana ? { svmKey: flags.solana } : {}),
    ...(flags.cluster ? { cluster: flags.cluster } : {}),
  });
  await signer(flags);
}

/** The same address: EVM in any hex case, Solana exactly. */
const sameAddress = (held: string, other: string) =>
  held === other ||
  (held.startsWith("0x") && held.toLowerCase() === other.toLowerCase());

/** Whether `signer` is a watched address: nothing here signs for it. */
export const isWatched = (signer: string) =>
  Object.values(loadState().watch ?? {}).some((held) =>
    sameAddress(held, signer),
  );

/** Watch `address` as its family's wallet: `0x` hex is EVM, base58 Solana. */
export function startWatching(address: string): string {
  const base58Key = () => {
    try {
      return bs58.decode(address).length === 32;
    } catch {
      return false;
    }
  };
  const family = isAddress(address, { strict: false })
    ? "evm"
    : base58Key()
      ? "svm"
      : undefined;
  if (!family)
    throw usage(`${address} is neither a 0x EVM nor a Solana address`);
  updateState({ watch: { ...loadState().watch, [family]: address } });
  return `Watching ${address} (watch-only): Aomi plans and simulates for it, and a transaction it prepares is exported for your own signer`;
}

/** `aomi watch [address]`, `aomi watch --remove <address>`. */
export async function watch(
  flags: { remove?: string },
  address?: string,
): Promise<void> {
  const watched = loadState().watch ?? {};
  if (flags.remove) {
    updateState({
      watch: Object.fromEntries(
        Object.entries(watched).filter(
          ([, held]) => !sameAddress(held, flags.remove!),
        ),
      ),
    });
    return out(`No longer watching ${flags.remove}`);
  }
  if (address) return out(startWatching(address));
  const rows = Object.entries(watched);
  if (!rows.length)
    return out("Not watching any address; aomi watch <address>");
  rows.forEach(([family, held]) => out(`${family.toUpperCase()}  ${held}`));
}

export async function clearSigner(): Promise<void> {
  updateState({ evmKey: undefined, svmKey: undefined, cluster: undefined });
  out("Local signer removed");
}
