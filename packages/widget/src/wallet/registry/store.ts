import { walletDebug } from "../wallet-debug";
import { planCommands } from "./commands";
import { loadPersisted, savePersisted } from "./persistence";
import { createInitialState, reduce } from "./reducer";
import type {
  RegistryCommand,
  RegistryEvent,
  WalletRegistryState,
} from "./types";
import { AUTH_FLOW_RECONNECT_SETTLE_MS, SETTLE_QUIET_MS } from "./types";

export type CommandExecutors = {
  wagmiReconnect(stableIds: string[]): Promise<void>;
  wagmiConnect(stableId: string): Promise<void>;
  wagmiDisconnect(uid: string): Promise<void>;
  svmConnect?(walletName: string): Promise<void>;
  svmDisconnect?(): Promise<void>;
  providerLogout(): Promise<void>;
};

export class WalletRegistryStore {
  private state: WalletRegistryState;
  private readonly subscribers = new Set<() => void>();
  private executors: CommandExecutors;
  private readonly storageKey: string;
  private settleTimer: number | null = null;

  constructor(opts: {
    executors: CommandExecutors;
    storageKey: string;
    initialNow: number;
  }) {
    this.executors = opts.executors;
    this.storageKey = opts.storageKey;
    const prev = createInitialState();
    const event: RegistryEvent = {
      type: "boot/init",
      persisted: loadPersisted(opts.storageKey, { migrateDestructively: true }),
      now: opts.initialNow,
    };
    this.state = reduce(prev, event);
    for (const command of planCommands(prev, this.state, event)) {
      this.executeCommand(command);
    }
  }

  getSnapshot(): WalletRegistryState {
    return this.state;
  }

  subscribe(cb: () => void): () => void {
    this.subscribers.add(cb);
    return () => {
      this.subscribers.delete(cb);
    };
  }

  updateExecutors(executors: Partial<CommandExecutors>): void {
    this.executors = { ...this.executors, ...executors };
  }

  dispatch(event: RegistryEvent): void {
    const prev = this.state;
    const next = reduce(prev, event);
    if (next === prev) return;

    this.state = next;
    for (const subscriber of this.subscribers) subscriber();

    const commands = planCommands(prev, next, event);
    for (const command of commands) {
      this.executeCommand(command);
    }

    if (event.type.startsWith("wagmi/") && event.type !== "wagmi/settled") {
      this.scheduleSettledPass(SETTLE_QUIET_MS);
    }
  }

  dispose(): void {
    if (this.settleTimer !== null && typeof window !== "undefined") {
      window.clearTimeout(this.settleTimer);
    }
    this.settleTimer = null;
  }

  private executeCommand(command: RegistryCommand): void {
    switch (command.kind) {
      case "persist":
        savePersisted(this.state, this.storageKey);
        break;
      case "debug":
        walletDebug(command.event, command.data);
        break;
      case "wagmi/reconnect":
        this.runAsync(command.kind, async () => {
          try {
            await this.executors.wagmiReconnect(command.stableIds);
          } finally {
            this.scheduleSettledPass(this.reconnectSettleDelayMs());
          }
        });
        break;
      case "wagmi/connect":
        this.runAsync(command.kind, () =>
          this.executors.wagmiConnect(command.stableId),
        );
        break;
      case "wagmi/disconnect":
        this.runAsync(command.kind, () =>
          this.executors.wagmiDisconnect(command.uid),
        );
        break;
      case "svm/connect":
        if (this.executors.svmConnect) {
          this.runAsync(command.kind, () =>
            this.executors.svmConnect!(command.walletName),
          );
        }
        break;
      case "svm/disconnect":
        if (this.executors.svmDisconnect) {
          this.runAsync(command.kind, () => this.executors.svmDisconnect!());
        }
        break;
      case "provider/logout":
        this.runAsync(command.kind, () => this.executors.providerLogout());
        break;
      default:
        break;
    }
  }

  private runAsync(
    kind: RegistryCommand["kind"],
    fn: () => Promise<void>,
  ): void {
    void fn().catch((error: unknown) => {
      walletDebug("registry:command-error", {
        kind,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }

  private reconnectSettleDelayMs(): number {
    const authFlowSuppressed =
      this.state.heal.suppressedUntil !== null &&
      Date.now() < this.state.heal.suppressedUntil &&
      (this.state.heal.suppressionReason === "provider-social-login" ||
        this.state.heal.suppressionReason === "provider-auth-modal" ||
        this.state.heal.suppressionReason === "provider-evm-connect-fallback" ||
        this.state.heal.suppressionReason === "provider-account-modal");
    return authFlowSuppressed ? AUTH_FLOW_RECONNECT_SETTLE_MS : SETTLE_QUIET_MS;
  }

  private scheduleSettledPass(delayMs: number): void {
    const run = () => {
      this.settleTimer = null;
      this.dispatch({ type: "wagmi/settled", now: Date.now() });
    };
    if (typeof window === "undefined") {
      queueMicrotask(run);
      return;
    }
    if (this.settleTimer !== null) {
      window.clearTimeout(this.settleTimer);
    }
    this.settleTimer = window.setTimeout(run, delayMs);
  }
}
