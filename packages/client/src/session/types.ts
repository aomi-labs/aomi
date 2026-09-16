import type {
  Action,
  Event,
  EventPage,
  MessageEvent,
  TurnState,
} from "../agent/types";
import type { ActionAttempt, ActionCapabilities } from "../actions";
import type { UserState } from "../user-state";
import type { AomiInferenceFundingSource } from "../agent/types";

export type SendResult = {
  messages: readonly MessageEvent[];
  title?: string;
};

export type SessionSnapshot = Readonly<{
  sessionId: string;
  cursor?: string;
  turnId?: string;
  turnState?: TurnState;
  events: readonly Event[];
  messages: readonly MessageEvent[];
  actions: readonly Action[];
  title?: string;
  isPolling: boolean;
  isSubmitting: boolean;
  /**
   * Optimistic echo of the outbound message for the in-flight turn. Set the
   * moment `send`/`sendAsync` is called and cleared when the server's own
   * user message event arrives (which can trail the start response by a
   * poll or two). Render this so the just-sent message never disappears.
   */
  pendingUserMessage?: string;
  actionAttempts: ReadonlyMap<string, ActionAttempt>;
  error?: unknown;
}>;

export type SessionOptions = {
  sessionId?: string;
  app?: string;
  model?: string | null;
  applicationId?: number | string | null;
  getUserState?: () => UserState | undefined;
  /** Explicit account funding lane for inference execution. */
  inferenceFunding?: AomiInferenceFundingSource;
  clientId?: string;
  pollIntervalMs?: number;
  logger?: { debug: (...args: unknown[]) => void };
  actions?: ActionCapabilities;
};

export type SessionRuntimeOptions = {
  app: string;
  model?: string | null;
  applicationId?: number | string | null;
  clientId?: string;
  getUserState?: () => UserState | undefined;
  inferenceFunding?: AomiInferenceFundingSource;
  actions?: ActionCapabilities;
};

export type { Action, Event, EventPage, TurnState };
