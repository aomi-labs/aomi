import type { components } from "../generated/agent-v1/types";

type Schemas = components["schemas"];

/** Selects user-owned BYOK credentials for inference. */
export type AomiInferenceFundingSource = "user_byok";

export type MessageEvent = Schemas["MessageEvent"];
export type Event = Schemas["ConcreteEvent"];
export type EventPage = Schemas["EventPage"];
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
export type AgentMode = "auto" | "direct";
export type AgentTarget =
  | {
      mode?: "auto";
      app?: never;
      applicationId?: never;
    }
  | {
      mode: "direct";
      /** Omit both identities to use the builtin default runtime. */
      applicationId?: number;
      /** Builtin name, or an exact-name consistency check for a hosted app. */
      app?: string;
    };
export type InterruptIntent = Schemas["InterruptIntent"];
export type RespondToActionIntent = Schemas["RespondToActionIntent"];
export type Session = Schemas["Session"];
export type SessionPage = Schemas["SessionPage"];
export type ErrorBody = Schemas["ErrorEnvelope"];
export type TurnState = TurnStateChangedEvent["state"];
