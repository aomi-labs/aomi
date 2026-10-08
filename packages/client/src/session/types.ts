import type {
  Action,
  AgentTarget,
  Event,
  EventPage,
  MessageEvent,
  TurnState,
} from "../agent/types";
import type { ActionAttempt, ActionCapabilities } from "../actions";
import type { UserState } from "../user-state";
import type { AomiInferenceFundingSource } from "../agent/types";
import type { CommitView, CommitCapabilities } from "../commits";

/**
 * Replace the conversation from a durable message and continue it as a normal
 * turn. `edit` is a user message key; `regenerate` reruns the user message
 * before an assistant message key.
 */
export type SendOptions = { regenerate?: string; edit?: string };

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
  /** Provisional display only; never advances the durable cursor. */
  liveMessages?: readonly MessageEvent[];
  actions: readonly Action[];
  commits: readonly CommitView[];
  title?: string;
  isStreaming: boolean;
  isSubmitting: boolean;
  /** True while Stop waits for the server to confirm it. */
  isStopping?: boolean;
  /** The backend may or may not have accepted the send; Stop can check and retry the same request. */
  isStartUncertain?: boolean;
  /** Scoped Stop ACK; the durable terminal event may arrive in a later page. */
  stoppedTurnId?: string;
  /** Scoped terminal ACKs retained until their ordered history catches up. */
  terminalTurns?: readonly Readonly<{
    turnId: string;
    state: "complete" | "failed" | "interrupted";
  }>[];
  /**
   * Optimistic echo of the outbound message for the in-flight turn. Set the
   * moment `send`/`sendAsync` is called and cleared when the server's own
   * user message event arrives (which can trail the start response by a
   * page or two). Render this so the just-sent message never disappears.
   */
  pendingUserMessage?: string;
  /** User message key that `pendingUserMessage` replaces (Edit or Rerun). */
  pendingReplacesMessageKey?: string;
  actionAttempts: ReadonlyMap<string, ActionAttempt>;
  /** Per-turn browser-clock durations; receipt is distinct from rendering. */
  timing?: Readonly<{
    startedAt: number;
    acknowledgedMs?: number;
    firstTextReceivedMs?: number;
  }>;
  error?: unknown;
}>;

export type SessionOptions = {
  commits?: CommitCapabilities;
  sessionId?: string;
  /** Typed execution target. Omission is Auto. */
  target?: AgentTarget;
  /** @deprecated Use `target: { mode: "direct", app }`. */
  app?: string;
  model?: string | null;
  /** @deprecated Use `target: { mode: "direct", applicationId }`. */
  applicationId?: number | string | null;
  getUserState?: () => UserState | undefined;
  /** Explicit account funding lane for inference execution. */
  inferenceFunding?: AomiInferenceFundingSource;
  clientId?: string;
  logger?: { debug: (...args: unknown[]) => void };
  actions?: ActionCapabilities;
};

export type SessionRuntimeOptions = {
  commits?: CommitCapabilities;
  target?: AgentTarget;
  /** @deprecated Legacy Direct app selection. */
  app?: string;
  model?: string | null;
  /** @deprecated Legacy Direct hosted-app selection. */
  applicationId?: number | string | null;
  clientId?: string;
  getUserState?: () => UserState | undefined;
  inferenceFunding?: AomiInferenceFundingSource;
  actions?: ActionCapabilities;
};

export type { Action, Event, EventPage, TurnState };
