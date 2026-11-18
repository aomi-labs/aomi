/**
 * Who finishes a trade a connection starts from an agent wallet: `ask_aomi`
 * (you approve it on Aomi), `ask_client` (the connection approves its own
 * trade: the CLI's `aomi tx approve`, an AI client's `aomi_approve`, a bot's
 * Approve card) or `instant` (it signs at once). Every connection sees every
 * wallet; the server reports each connection's effective ask mode.
 */
export type AomiAskMode = "ask_aomi" | "ask_client" | "instant";

/** An ask mode from the wire; anything else reads as `ask_aomi`. */
export function askModeOf(value: unknown): AomiAskMode {
  return value === "ask_client" || value === "instant" ? value : "ask_aomi";
}
