/**
 * Who finishes a trade a connection starts from an agent wallet: `portal` (you
 * approve it on the portal), `here` (the connection approves its own trade: the
 * CLI's `aomi tx approve`, an AI client's `aomi_approve`, a bot's Approve
 * card) or `instant` (it signs at once). Every connection sees every wallet;
 * the server reports each connection's effective lane.
 */
export type AomiLane = "portal" | "here" | "instant";

/** A lane from the wire; anything else reads as `portal`. */
export function laneOf(value: unknown): AomiLane {
  return value === "here" || value === "instant" ? value : "portal";
}
