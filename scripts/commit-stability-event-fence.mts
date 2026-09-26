/** Keep terminal observations scoped to the current durable turn. */
export type TurnEvent = {
  type: string;
  turn_id?: string | null;
  sequence: number;
  state?: string;
  sender?: string;
  message_key?: string | null;
  content?: string;
  is_streaming?: boolean;
};

export const newestProcessingTurn = (
  events: readonly TurnEvent[],
): string | undefined =>
  [...events]
    .reverse()
    .find(
      (item) =>
        item.type === "turn_state_changed" &&
        item.state === "processing" &&
        item.turn_id?.startsWith("turn_"),
    )?.turn_id ?? undefined;

export const isCompleteForTurn = (
  item: TurnEvent,
  turnId: string,
  afterSequence: number,
): boolean =>
  item.type === "turn_state_changed" &&
  item.state === "complete" &&
  item.turn_id === turnId &&
  item.sequence > afterSequence;

export const isTerminalForTurn = (
  item: TurnEvent,
  turnId: string,
  afterSequence: number,
): boolean =>
  item.type === "turn_state_changed" &&
  ["complete", "failed", "interrupted"].includes(item.state ?? "") &&
  item.turn_id === turnId &&
  item.sequence > afterSequence;

/** A parent turn or an empty response cannot prove callback answer delivery. */
export function callbackReadback(
  events: readonly TurnEvent[],
  operationId: string,
) {
  const turnId = `broadcast-terminal:${operationId}`;
  const latestState = events
    .filter(
      (item) => item.type === "turn_state_changed" && item.turn_id === turnId,
    )
    .sort((a, b) => b.sequence - a.sequence)[0];
  const answer = events.find(
    (item) =>
      item.type === "message" &&
      item.turn_id === turnId &&
      item.message_key === `${turnId}:response` &&
      item.sender === "agent" &&
      item.is_streaming === false &&
      Boolean(item.content?.trim()) &&
      latestState &&
      item.sequence < latestState.sequence,
  );
  return {
    state: latestState?.state,
    ready: latestState?.state === "complete" && Boolean(answer),
  };
}
