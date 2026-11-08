/**
 * Who finishes a trade a connection starts from an agent wallet: `ask_aomi`
 * (you approve it on Aomi), `ask_client` (the connection approves its own
 * trade: the CLI's `aomi tx approve`, an AI client's `aomi_approve`, a bot's
 * Approve card) or `instant` (it signs at once). Every connection sees every
 * wallet; the server reports each connection's effective lane.
 */
export type AomiLane = "ask_aomi" | "ask_client" | "instant";

/** The spellings servers sent before the rename, and what they mean now. */
const LEGACY_LANES: Record<string, AomiLane> = {
  portal: "ask_aomi",
  here: "ask_client",
};

/**
 * A lane from the wire or storage, legacy spellings included. Anything else
 * reads as `ask_aomi`: the owner approves, the fail-safe.
 */
export function normalizeLane(value: unknown): AomiLane {
  if (value === "ask_client" || value === "instant") return value;
  return (typeof value === "string" && LEGACY_LANES[value]) || "ask_aomi";
}
