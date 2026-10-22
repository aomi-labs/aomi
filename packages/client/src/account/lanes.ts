/**
 * Who finishes a trade a connection starts from an agent wallet: `aomi` (you
 * approve it on Aomi), `here` (the connection approves its own trade: the
 * CLI's `aomi tx approve`, an AI client's `aomi_approve`, a bot's Approve
 * card) or `instant` (it signs at once). Every connection sees every wallet;
 * the server reports each connection's effective lane.
 */
export type AomiLane = "aomi" | "here" | "instant";

/** A lane from the wire; anything else reads as `aomi`. */
export function laneOf(value: unknown): AomiLane {
  return value === "here" || value === "instant" ? value : "aomi";
}
