import type { AomiConnectionKind } from "./connections";

/**
 * Who finishes a trade a connection starts from an agent wallet: `aomi` (you
 * approve it on Aomi), `here` (the connection approves its own trade: the
 * CLI's `aomi tx approve`, an AI client's `aomi_approve`, a bot's Approve
 * card) or `instant` (it signs at once). Every connection sees every wallet;
 * a wallet with no lane set uses the client's default ({@link defaultLane}).
 */
export type AomiLane = "aomi" | "here" | "instant";

/** A connection's lane on a wallet it has no row for: a chat bot approves
 * with its card, the portal approves, everything else waits on Aomi. */
export function defaultLane(kind: AomiConnectionKind): AomiLane {
  return kind === "telegram" || kind === "portal" ? "here" : "aomi";
}

/** A lane from the wire; anything else reads as `aomi`. */
export function laneOf(value: unknown): AomiLane {
  return value === "here" || value === "instant" ? value : "aomi";
}
