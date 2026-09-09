import type { components } from "../generated/agent-v1/types";

type Schemas = components["schemas"];

/** Selects user-owned BYOK credentials for inference. */
export type AomiInferenceFundingSource = "user_byok";

type GeneratedMessageEvent = Schemas["MessageEvent"];

/**
 * The recorder bridges INLINE (sync-executed) tool steps as agent `message` events
 * carrying these fields; typed `tool_update`/`tool_complete` events cover
 * only the async path. The backend's OpenAPI contract does not declare them
 * yet, so they are added to the consumer shape here — one honest type
 * instead of every consumer duck-typing the wire.
 */
export type MessageEvent = GeneratedMessageEvent & {
  /** `[topic, payload]`: human topic label plus the tool's JSON (or plain-text) result. */
  tool_result?: [topic: string, payload: string] | null;
  /** Canonical tool name; consumers fall back to `topic` when absent. */
  tool_name?: string | null;
  /** Tool call arguments, when the recorder attaches them. */
  tool_arguments?: unknown;
};

export type Event =
  | Exclude<Schemas["ConcreteEvent"], GeneratedMessageEvent>
  | MessageEvent;
export type EventPage = Omit<Schemas["EventPage"], "events"> & {
  events: Event[];
};
export type TurnStateChangedEvent = Schemas["TurnStateChangedEvent"];
export type ToolUpdateEvent = Schemas["ToolUpdateEvent"];
export type ToolCompleteEvent = Schemas["ToolCompleteEvent"];
export type TaskStartedEvent = Schemas["TaskStartedEvent"];
export type TaskPhaseEvent = Schemas["TaskPhaseEvent"];
export type TaskActivityEvent = Schemas["TaskActivityEvent"];
export type TaskCompletedEvent = Schemas["TaskCompletedEvent"];
export type TitleEvent = Schemas["TitleEvent"];
export type ErrorEvent = Schemas["ErrorEvent"];
export type Action = Schemas["Action"];
export type ActionRequest = Schemas["ActionRequest"];
export type ActionResult = Schemas["ActionResult"];
export type UserState = Schemas["UserState"];
export type StartTurnIntent = Schemas["StartTurnIntent"];
export type InterruptIntent = Schemas["InterruptIntent"];
export type RespondToActionIntent = Schemas["RespondToActionIntent"];
export type Session = Schemas["Session"];
export type SessionPage = Schemas["SessionPage"];
export type ErrorBody = Schemas["ErrorEnvelope"];
export type TurnState = TurnStateChangedEvent["state"];
