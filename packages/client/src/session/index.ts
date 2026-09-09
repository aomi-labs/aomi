import type {
  Event,
  EventPage,
  MessageEvent,
  StartTurnIntent,
  TurnState,
} from "../agent/types";
import { ActionHandler } from "../actions";
import { AgentApiError } from "../agent/transport";
import { AomiClient } from "../client";
import type { AomiClientOptions } from "../types";
import type {
  SendResult,
  SessionOptions,
  SessionRuntimeOptions,
  SessionSnapshot,
} from "./types";

export { aaModeFromExecutionKind } from "../aa/policy";
export type {
  Event,
  EventPage,
  SendResult,
  SessionOptions,
  SessionRuntimeOptions,
  SessionSnapshot,
  TurnState,
} from "./types";

const TERMINAL_TURN_STATES = new Set<TurnState>([
  "complete",
  "interrupted",
  "failed",
]);
const TERMINAL_EVENT_DRAIN_MS = 60_000;

/** One Agent session reduced from its single ordered Event stream. */
export class ClientSession {
  readonly client: AomiClient;
  readonly sessionId: string;
  readonly actions: ActionHandler;

  private app: string;
  private model?: string | null;
  private applicationId?: number | string | null;
  private getUserState?: SessionOptions["getUserState"];
  private inferenceFunding?: SessionOptions["inferenceFunding"];
  private clientId: string;
  private pollIntervalMs: number;
  private logger?: { debug: (...args: unknown[]) => void };
  private cursor?: string;
  private turnId?: string;
  private turnState?: TurnState;
  private startOperation?: {
    message: string;
    idempotencyKey: string;
    intent?: StartTurnIntent;
  };
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private pollingActive = false;
  private pollInFlight = false;
  private pollFailureCount = 0;
  private awaitingResume = false;
  private terminalDrainUntil?: number;
  private terminalTurnId?: string;
  private isSubmitting = false;
  private pendingUserMessage?: { content: string; sinceSequence: number };
  private events: Event[] = [];
  private eventIds = new Set<string>();
  private messages: MessageEvent[] = [];
  private storeVersion = 0;
  private cachedStore?: {
    version: number;
    events: Event[];
    messages: MessageEvent[];
  };
  private lastPageNewEvents = 0;
  private title?: string;
  private error?: unknown;
  private closed = false;
  private pendingResolve: ((result: SendResult) => void) | null = null;
  private listeners = new Set<() => void>();
  private actionUnsubscribers: Array<() => void> = [];
  private snapshot: SessionSnapshot;
  private applyingPage = false;

  constructor(
    clientOrOptions: AomiClient | AomiClientOptions,
    sessionOptions?: SessionOptions,
  ) {
    this.client =
      clientOrOptions instanceof AomiClient
        ? clientOrOptions
        : new AomiClient(clientOrOptions);
    this.sessionId = sessionOptions?.sessionId ?? crypto.randomUUID();
    this.app = sessionOptions?.app ?? "default";
    this.model = sessionOptions?.model;
    this.applicationId = sessionOptions?.applicationId;
    this.getUserState = sessionOptions?.getUserState;
    this.inferenceFunding = sessionOptions?.inferenceFunding;
    this.clientId = sessionOptions?.clientId ?? crypto.randomUUID();
    this.pollIntervalMs = sessionOptions?.pollIntervalMs ?? 500;
    this.logger = sessionOptions?.logger;
    this.actions = new ActionHandler(
      sessionOptions?.actions ?? {},
      (action, result, idempotencyKey) =>
        this.client.agent.respondToAction(
          this.sessionId,
          action.id,
          action.revision,
          result,
          idempotencyKey,
        ),
    );
    this.snapshot = this.buildSnapshot();
    this.actionUnsubscribers.push(
      this.actions.subscribe(() => {
        if (!this.applyingPage) this.publish();
      }),
      this.actions.on("resolved", () => {
        this.awaitingResume = true;
        this.startPolling();
      }),
    );
  }

  getSnapshot = (): SessionSnapshot => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  async send(message: string): Promise<SendResult> {
    const page = await this.submit(message);
    if (this.isTerminal()) {
      this.drainTerminalPage(page);
      // The drain may still be polling for the trailing final message /
      // title; only a finished drain has the complete result in hand.
      if (!this.pollingActive) return this.result();
    } else if (this.turnState !== "awaiting_action" || page.has_more) {
      this.startPolling();
    }
    return new Promise((resolve) => {
      this.pendingResolve = resolve;
    });
  }

  async sendAsync(message: string): Promise<EventPage> {
    const page = await this.submit(message);
    if (this.isTerminal()) {
      this.drainTerminalPage(page);
      return page;
    }
    if (this.turnState !== "awaiting_action" || page.has_more) {
      this.startPolling();
    }
    return page;
  }

  async interrupt(): Promise<void> {
    if (!this.turnId) throw new Error("No active turn to interrupt");
    this.stopPolling();
    this.applyEventPage(
      await this.client.agent.interrupt(this.sessionId, this.turnId),
    );
    if (this.isTerminal()) this.finish();
  }

  syncRuntimeOptions(options: SessionRuntimeOptions): void {
    this.app = options.app;
    this.model = options.model;
    this.applicationId = options.applicationId;
    this.clientId = options.clientId ?? this.clientId;
    this.getUserState = options.getUserState;
    this.inferenceFunding = options.inferenceFunding;
    if (options.actions) this.actions.setCapabilities(options.actions);
  }

  async sync(): Promise<EventPage> {
    this.assertOpen();
    return this.fetchPage();
  }

  async fetchCurrentState(): Promise<void> {
    const page = await this.sync();
    if (this.isTerminal()) this.finish();
    else if (this.turnState && this.turnState !== "awaiting_action") {
      this.startPolling();
    }
    if (page.has_more) this.startPolling();
  }

  startPolling(): void {
    if (this.pollingActive || this.closed) return;
    this.pollingActive = true;
    this.logger?.debug("[session] polling started", this.sessionId);
    if (typeof document !== "undefined") {
      document.addEventListener(
        "visibilitychange",
        this.handleVisibilityChange,
      );
    }
    this.publish();
    this.schedulePoll(0);
  }

  stopPolling(): void {
    if (!this.pollingActive && !this.pollTimer) return;
    this.pollingActive = false;
    if (this.pollTimer) clearTimeout(this.pollTimer);
    this.pollTimer = null;
    if (typeof document !== "undefined") {
      document.removeEventListener(
        "visibilitychange",
        this.handleVisibilityChange,
      );
    }
    this.logger?.debug("[session] polling stopped", this.sessionId);
    this.publish();
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.stopPolling();
    this.resolvePending();
    for (const unsubscribe of this.actionUnsubscribers) unsubscribe();
    this.actionUnsubscribers = [];
    this.actions.close();
    this.listeners.clear();
  }

  private async submit(message: string): Promise<EventPage> {
    this.assertOpen();
    const text = message.trim();
    if (!text) throw new TypeError("message is required");
    const applicationId = Number(this.applicationId);
    const operation: NonNullable<ClientSession["startOperation"]> =
      this.startOperation?.message === text
        ? this.startOperation
        : {
            message: text,
            idempotencyKey: `idem_${crypto.randomUUID().replaceAll("-", "")}`,
          };
    this.startOperation = operation;
    this.awaitingResume = false;
    this.terminalDrainUntil = undefined;
    this.terminalTurnId = undefined;
    this.isSubmitting = true;
    // The start response and even the first polls may not carry the user's
    // message event yet (it can trail in a later page). Hold an optimistic
    // echo so consumers can render the outbound message immediately; it is
    // cleared the moment the server's own user message event lands.
    this.pendingUserMessage = {
      content: text,
      sinceSequence: this.events.at(-1)?.sequence ?? 0,
    };
    this.error = undefined;
    this.publish();
    try {
      if (!operation.intent) {
        const selected = this.getUserState?.();
        const state = selected
          ? await this.client.prepareUserState(this.sessionId, selected)
          : undefined;
        // An uncertain start must replay exactly the same intent and key.
        // Fresh operations refresh policy; execution still checks live authority.
        operation.intent = {
          sessionId: this.sessionId,
          clientId: this.clientId,
          message: text,
          ...(Number.isSafeInteger(applicationId) && applicationId > 0
            ? { applicationId }
            : { app: this.app }),
          ...(this.model ? { model: this.model } : {}),
          ...(state
            ? {
                userState: structuredClone(state),
              }
            : {}),
        };
      }
      const page = await this.client.agent.start(operation.intent, {
        idempotencyKey: operation.idempotencyKey,
        inferenceFunding: this.inferenceFunding,
      });
      this.startOperation = undefined;
      this.applyEventPage(page);
      return page;
    } catch (error) {
      this.error = error;
      this.pendingUserMessage = undefined;
      if (error instanceof AgentApiError && !error.retryable) {
        this.startOperation = undefined;
      }
      throw error;
    } finally {
      this.isSubmitting = false;
      this.publish();
    }
  }

  private async fetchPage(waitMs = 0): Promise<EventPage> {
    try {
      const page = await this.client.agent.poll(this.sessionId, {
        cursor: this.cursor,
        waitMs,
      });
      this.applyEventPage(page);
      return page;
    } catch (error) {
      if (
        !(error instanceof AgentApiError) ||
        error.code !== "invalid_cursor"
      ) {
        throw error;
      }
      this.cursor = undefined;
      const page = await this.client.agent.poll(this.sessionId);
      this.applyEventPage(page);
      return page;
    }
  }

  private applyEventPage(page: EventPage): void {
    if (page.session_id !== this.sessionId) {
      throw new TypeError("Agent response session does not match the request");
    }
    this.applyingPage = true;
    this.lastPageNewEvents = 0;
    try {
      for (const event of page.events) {
        if (this.eventIds.has(event.event_id)) continue;
        const previous = this.events.at(-1);
        if (previous && event.sequence <= previous.sequence) {
          throw new TypeError("Agent events are not monotonically ordered");
        }
        this.eventIds.add(event.event_id);
        this.events.push(event);
        this.storeVersion += 1;
        this.lastPageNewEvents += 1;
        this.turnId = event.turn_id ?? this.turnId;
        switch (event.type) {
          case "message":
            this.applyMessage(event);
            if (
              event.sender === "user" &&
              this.pendingUserMessage &&
              event.sequence > this.pendingUserMessage.sinceSequence
            ) {
              this.pendingUserMessage = undefined;
            }
            break;
          case "turn_state_changed":
            this.turnState = event.state;
            if (TERMINAL_TURN_STATES.has(event.state)) {
              this.terminalTurnId = event.turn_id ?? this.turnId;
            }
            if (event.state !== "awaiting_action") {
              this.awaitingResume = false;
            }
            break;
          case "title_changed":
            this.title = event.title;
            break;
          case "action":
            this.actions.ingest(event);
            break;
        }
      }
      this.cursor = page.cursor;
      this.error = undefined;
    } finally {
      this.applyingPage = false;
    }
    this.publish();
  }

  private applyMessage(event: MessageEvent): void {
    const key = event.message_key ?? event.event_id;
    const index = this.messages.findIndex(
      (message) => (message.message_key ?? message.event_id) === key,
    );
    if (index >= 0) this.messages[index] = event;
    else this.messages.push(event);
  }

  private async pollTick(): Promise<void> {
    if (!this.pollingActive || this.pollInFlight) return;
    this.pollTimer = null;
    this.pollInFlight = true;
    try {
      const page = await this.fetchPage(25_000);
      this.pollFailureCount = 0;
      if (this.isTerminal()) this.drainTerminalPage(page);
      else if (
        this.turnState === "awaiting_action" &&
        !this.awaitingResume &&
        !page.has_more
      ) {
        this.stopPolling();
      }
    } catch (error) {
      this.pollFailureCount += 1;
      this.error = error;
      this.logger?.debug("[session] poll error", error);
      this.publish();
    } finally {
      this.pollInFlight = false;
      if (this.pollingActive) {
        this.schedulePoll(
          Math.min(
            this.currentPollInterval() * 2 ** this.pollFailureCount,
            5_000,
          ),
        );
      }
    }
  }

  private finish(): void {
    this.awaitingResume = false;
    this.terminalDrainUntil = undefined;
    this.terminalTurnId = undefined;
    this.pendingUserMessage = undefined;
    this.stopPolling();
    this.resolvePending();
  }

  private drainTerminalPage(page: EventPage): void {
    // A turn's final answer can trail its terminal state. Finish only after
    // the current terminal turn has a settled, non-tool agent message and the
    // current page is fully drained. Titles are asynchronous thread metadata:
    // they may be unchanged, delayed, or absent, so they cannot be a sentinel.
    if (!page.has_more && this.hasTerminalAnswer()) {
      this.finish();
      return;
    }
    this.terminalDrainUntil ??= Date.now() + TERMINAL_EVENT_DRAIN_MS;
    if (
      !page.has_more &&
      this.lastPageNewEvents === 0 &&
      Date.now() >= this.terminalDrainUntil
    ) {
      this.finish();
      return;
    }
    this.startPolling();
  }

  private hasTerminalAnswer(): boolean {
    const turnId = this.terminalTurnId;
    if (!turnId) return false;
    return this.events.some(
      (event) =>
        event.type === "message" &&
        event.turn_id === turnId &&
        event.sender === "agent" &&
        event.is_streaming !== true &&
        !event.tool_result &&
        event.content.trim().length > 0,
    );
  }

  private isTerminal(): boolean {
    return Boolean(this.turnState && TERMINAL_TURN_STATES.has(this.turnState));
  }

  private result(): SendResult {
    return { messages: this.messages, title: this.title };
  }

  private resolvePending(): void {
    const resolve = this.pendingResolve;
    this.pendingResolve = null;
    resolve?.(this.result());
  }

  private buildSnapshot(): SessionSnapshot {
    // Keep the events/messages array identities stable across publishes that
    // did not apply new events, so downstream memoized projections (React's
    // useMemo on snapshot.events) don't rebuild every poll tick.
    if (!this.cachedStore || this.cachedStore.version !== this.storeVersion) {
      this.cachedStore = {
        version: this.storeVersion,
        events: [...this.events],
        messages: [...this.messages],
      };
    }
    return {
      sessionId: this.sessionId,
      ...(this.cursor ? { cursor: this.cursor } : {}),
      ...(this.turnId ? { turnId: this.turnId } : {}),
      ...(this.turnState ? { turnState: this.turnState } : {}),
      events: this.cachedStore.events,
      messages: this.cachedStore.messages,
      actions: this.actions.all(),
      ...(this.title ? { title: this.title } : {}),
      isPolling: this.pollingActive,
      isSubmitting: this.isSubmitting,
      ...(this.pendingUserMessage
        ? { pendingUserMessage: this.pendingUserMessage.content }
        : {}),
      actionAttempts: this.actions.allAttempts(),
      ...(this.error === undefined ? {} : { error: this.error }),
    };
  }

  private publish(): void {
    this.snapshot = this.buildSnapshot();
    for (const listener of this.listeners) listener();
  }

  private currentPollInterval(): number {
    return typeof document !== "undefined" && document.hidden
      ? 2_000
      : this.pollIntervalMs;
  }

  private schedulePoll(delayMs: number): void {
    if (!this.pollingActive || this.closed) return;
    if (this.pollTimer) clearTimeout(this.pollTimer);
    this.pollTimer = setTimeout(() => void this.pollTick(), delayMs);
  }

  private handleVisibilityChange = (): void => {
    if (
      typeof document !== "undefined" &&
      !document.hidden &&
      !this.pollInFlight
    ) {
      this.schedulePoll(0);
    }
  };

  private assertOpen(): void {
    if (this.closed) throw new Error("Session is closed");
  }
}
