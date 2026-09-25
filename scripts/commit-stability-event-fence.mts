/** Keep terminal observations scoped to the current durable turn. */
export type TurnEvent = {
  type: string;
  turn_id?: string | null;
  sequence: number;
  state?: string;
};

export const newestProcessingTurn = (events: readonly TurnEvent[]): string | undefined =>
  [...events].reverse().find((item) => item.type === "turn_state_changed"
    && item.state === "processing" && item.turn_id?.startsWith("turn_"))?.turn_id ?? undefined;

export const isCompleteForTurn = (item: TurnEvent, turnId: string, afterSequence: number): boolean =>
  item.type === "turn_state_changed" && item.state === "complete"
  && item.turn_id === turnId && item.sequence > afterSequence;

export const isTerminalForTurn = (item: TurnEvent, turnId: string, afterSequence: number): boolean =>
  item.type === "turn_state_changed" && ["complete", "failed", "interrupted"].includes(item.state ?? "")
  && item.turn_id === turnId && item.sequence > afterSequence;
