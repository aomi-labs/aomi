// The one wire shape every e2e fake speaks. Types come straight from the
// client's generated OpenAPI schema so a protocol change breaks this file at
// type-check time instead of silently drifting the fake away from the client.
import type {
  Action,
  Event,
  EventPage,
  Session,
  SessionPage,
  StartTurnIntent,
  TurnState,
} from "../../../packages/client/src/agent/types";

export type {
  Action,
  Event,
  EventPage,
  Session,
  SessionPage,
  StartTurnIntent,
  TurnState,
};

/** SSE frame names the client's `AgentTransport.stream` understands. */
export type StreamFrame =
  | { event: "page"; data: EventPage }
  | { event: "message"; data: Partial<Event> }
  | { event: "resync"; data: Record<string, never> };

/** Axum-style LF framing; the client also accepts CRLF. */
export function encodeFrame(frame: StreamFrame): string {
  return `event: ${frame.event}\ndata: ${JSON.stringify(frame.data)}\n\n`;
}

/** Event without the envelope fields the backend assigns. */
export type EventBody = Event extends infer E
  ? E extends Event
    ? Omit<E, "event_id" | "sequence" | "turn_id" | "occurred_at">
    : never
  : never;

export type ErrorBody = {
  error: { code: string; message: string; retryable?: boolean };
};
