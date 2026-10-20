import type {
  AomiAccountConnection,
  AomiConnectionWalletsUpdate,
} from "@aomi-labs/client";

export type PairMode = "ask" | "instant";

/**
 * The full pair list a connection should hold once wallet `id` gets `mode`
 * (or loses access, with null); its other pairs stay as they are, archived
 * wallets' included, so a restore brings them back. The portal may always
 * use every wallet, so its list only stores Instant.
 */
export function pairsWith(
  connection: AomiAccountConnection,
  id: string,
  mode: PairMode | null,
): AomiConnectionWalletsUpdate["wallets"] {
  const pairs = connection.wallets
    .filter((wallet) => wallet.id !== id)
    .map((wallet) => ({ id: wallet.id, instant: wallet.instant }));
  if (mode)
    pairs.push({ id, instant: mode === "instant" && !connection.ask_only });
  return connection.kind === "portal"
    ? pairs.filter((pair) => pair.instant)
    : pairs;
}
