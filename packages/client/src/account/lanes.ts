/**
 * Who finishes a trade a connection starts from an agent wallet: `ask_aomi`
 * (you approve it on Aomi), `ask_client` (the connection approves its own
 * trade: the CLI's `aomi tx approve`, an AI client's `aomi_approve`, a bot's
 * Approve card) or `instant` (it signs at once). Every connection sees every
 * wallet; the server reports each connection's effective lane.
 */
export type AomiLane = "ask_aomi" | "ask_client" | "instant";

/** A lane from the wire; anything else reads as `ask_aomi`. */
export function laneOf(value: unknown): AomiLane {
  return value === "ask_client" || value === "instant" ? value : "ask_aomi";
}
