import type {
  AomiAccountConnection,
  AomiConnectionWalletsUpdate,
  AomiLane,
} from "@aomi-labs/client";

/**
 * The full lane list a connection should hold once wallet `id` gets `lane`;
 * its other lanes stay as they are, archived wallets' included, so a
 * restore brings them back.
 */
export function pairsWith(
  connection: AomiAccountConnection,
  id: string,
  lane: AomiLane,
): AomiConnectionWalletsUpdate["wallets"] {
  return [
    ...connection.wallets
      .filter((wallet) => wallet.id !== id)
      .map((wallet) => ({ id: wallet.id, lane: wallet.lane })),
    { id, lane: connection.ask_only ? "aomi" : lane },
  ];
}
