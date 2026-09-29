"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type FC,
  type ReactNode,
} from "react";
import { cn, useOptionalAomiRuntime } from "@aomi-labs/react";
import type { TransactionSafetyMode } from "@aomi-labs/client";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useAomiWalletKit } from "../../lib/wallet-kit";
import {
  TRANSACTION_SAFETY_LEVELS,
  YOLO_CONFIRM_BODY,
  YOLO_CONFIRM_TITLE,
  transactionSafetyLevel,
} from "@/components/account-shell/features/policy/transaction-safety-levels";
import {
  useThreadTransactionSafety,
  type ThreadTransactionSafety,
} from "@/components/account-shell/features/policy/use-thread-transaction-safety";
import { requestSettingsOpen } from "@/components/account-shell/lib/settings-events";
import {
  ControlMenuCheck,
  ControlMenuTitle,
  ControlSelectChevron,
  controlMenuContentClass,
  controlMenuIconClass,
  controlMenuItemClass,
  controlSelectTriggerClass,
} from "./control-menu";

export type SafetySelectProps = { className?: string };

function useChatSafety(enabled: boolean, canHold: boolean) {
  const walletKit = useAomiWalletKit();
  const runtime = useOptionalAomiRuntime();
  return useThreadTransactionSafety({
    threadId: runtime?.currentThreadId,
    // A chat has a backend thread once the backend has sent it events.
    threadReady: Boolean(runtime?.events.length),
    enabled:
      enabled &&
      Boolean(runtime) &&
      Boolean(walletKit.accountUser) &&
      !walletKit.accountGuest,
    canHold,
  });
}

const ThreadSafetyContext = createContext<ThreadTransactionSafety | null>(null);

/**
 * Chat safety shared by the composer's selector and its send paths. Only a
 * composer that awaits `commitHeld` before sending may mount this, since it
 * lets a new chat hold a level for its first turn.
 */
export function ThreadSafetyProvider({
  enabled = true,
  children,
}: {
  enabled?: boolean;
  children: ReactNode;
}) {
  const safety = useChatSafety(enabled, true);
  return (
    <ThreadSafetyContext.Provider value={safety}>
      {children}
    </ThreadSafetyContext.Provider>
  );
}

export const useThreadSafety = () => useContext(ThreadSafetyContext);

const DEFAULT_KEY = "aomi:transaction-safety-default";

/** The last account default this browser saw, so the trigger can render with
 * the model selector instead of popping in once the account request lands. */
function rememberedDefault(): TransactionSafetyMode {
  try {
    const stored = window.localStorage.getItem(DEFAULT_KEY);
    if (TRANSACTION_SAFETY_LEVELS.some((level) => level.id === stored))
      return stored as TransactionSafetyMode;
  } catch {
    /* Storage can be blocked; fall back to the platform default. */
  }
  return "balanced";
}

function rememberDefault(mode: TransactionSafetyMode) {
  try {
    window.localStorage.setItem(DEFAULT_KEY, mode);
  } catch {
    /* Only a first-paint hint; nothing to recover. */
  }
}

/**
 * This chat's transaction safety level, always named on the trigger. It is
 * present from first paint: signed out it shows the default and can't be
 * opened; signed in it shows the remembered default until the account answers.
 * Outside a ThreadSafetyProvider nothing gates the first send, so the level
 * locks until the chat has started.
 */
export const SafetySelect: FC<SafetySelectProps> = ({ className }) => {
  const shared = useThreadSafety();
  const local = useChatSafety(!shared, false);
  const safety = shared ?? local;
  const walletKit = useAomiWalletKit();
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const accountMode = safety.account?.mode;
  useEffect(() => {
    if (accountMode) rememberDefault(accountMode);
  }, [accountMode]);

  if (!safety.account || !safety.mode) {
    const signedIn = Boolean(walletKit.accountUser) && !walletKit.accountGuest;
    const level = transactionSafetyLevel(rememberedDefault());
    return (
      <Button
        type="button"
        variant="ghost"
        aria-disabled="true"
        aria-label={`Guard policy: ${level.label}`}
        title={signedIn ? undefined : "Sign in to change the guard policy"}
        className={cn(
          controlSelectTriggerClass,
          "hover:text-aomi-muted w-auto cursor-default justify-start hover:bg-transparent",
          !signedIn && "opacity-60",
          className,
        )}
      >
        <div className="flex items-center gap-px md:gap-1.5">
          <level.Icon className="h-3 w-3 shrink-0 opacity-60" />
          <span className="truncate">{level.label}</span>
        </div>
        <ControlSelectChevron />
      </Button>
    );
  }

  const level = transactionSafetyLevel(safety.mode);
  const accountLevel = transactionSafetyLevel(safety.account.mode);
  const locked = !safety.started && !safety.canHold;

  const apply = (mode: TransactionSafetyMode) => {
    setOpen(false);
    setConfirming(false);
    void safety.select(mode);
  };
  const choose = (mode: TransactionSafetyMode) => {
    if (mode === "unrestricted" && safety.mode !== "unrestricted")
      setConfirming(true);
    else apply(mode);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        setConfirming(false);
        if (next) safety.refreshAccount();
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          role="combobox"
          aria-expanded={open}
          aria-label={`Guard policy: ${level.label}`}
          disabled={safety.busy}
          className={cn(
            controlSelectTriggerClass,
            "w-auto justify-start",
            level.danger && "text-aomi-danger hover:text-aomi-danger",
            className,
          )}
        >
          <div className="flex items-center gap-px md:gap-1.5">
            <level.Icon
              className={cn("h-3 w-3 shrink-0", !level.danger && "opacity-60")}
            />
            <span className="truncate">{level.label}</span>
          </div>
          <ControlSelectChevron />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="bottom"
        sideOffset={4}
        avoidCollisions
        collisionPadding={8}
        className={controlMenuContentClass}
      >
        {confirming ? (
          <div
            role="group"
            aria-labelledby="aomi-yolo-confirm-title"
            className="px-2.5 pb-0.5 pt-1"
          >
            <p
              id="aomi-yolo-confirm-title"
              className="text-aomi-danger text-[13px] font-medium"
            >
              {YOLO_CONFIRM_TITLE}
            </p>
            <p className="text-aomi-muted mt-1 text-[12px] leading-[18px]">
              {YOLO_CONFIRM_BODY}
            </p>
            <div className="mt-3 flex justify-end gap-1.5">
              <button
                type="button"
                onClick={() => setConfirming(false)}
                className="text-aomi-muted hover:bg-aomi-hover hover:text-aomi-fg rounded-control h-7 px-2.5 text-[12px] font-medium transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => apply("unrestricted")}
                className="bg-aomi-danger-strong text-aomi-on-danger rounded-control h-7 px-2.5 text-[12px] font-medium transition-opacity hover:opacity-90"
              >
                Turn on
              </button>
            </div>
          </div>
        ) : (
          <>
            <ControlMenuTitle>Guard policy</ControlMenuTitle>
            {locked && (
              <p className="text-aomi-muted px-2.5 pb-1.5 text-[11px] leading-4">
                Set after your first message
              </p>
            )}
            <div className="space-y-0.5">
              {TRANSACTION_SAFETY_LEVELS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  aria-pressed={item.id === level.id}
                  disabled={safety.busy || locked}
                  onClick={() => choose(item.id)}
                  className={cn(
                    controlMenuItemClass,
                    "hover:bg-aomi-hover disabled:opacity-50 disabled:hover:bg-transparent",
                  )}
                >
                  <span
                    className={cn(
                      controlMenuIconClass,
                      item.danger && "text-aomi-danger",
                    )}
                  >
                    <item.Icon className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span
                      className={cn(
                        "block text-[13px] font-medium",
                        item.danger && "text-aomi-danger",
                      )}
                    >
                      {item.label}
                    </span>
                    <span className="text-aomi-muted block text-[11px] leading-4">
                      {item.description}
                    </span>
                  </span>
                  <ControlMenuCheck selected={item.id === level.id} />
                </button>
              ))}
            </div>
            {safety.error && (
              <p
                role="alert"
                className="text-aomi-danger break-words px-2.5 pt-1.5 text-[11px] leading-4"
              >
                {safety.error}
              </p>
            )}
            <div className="border-aomi-border mt-1.5 flex items-center gap-2 border-t px-2.5 pb-0.5 pt-2 text-[12px]">
              <span className="text-aomi-muted min-w-0 flex-1 truncate">
                New chats start on {accountLevel.label}
              </span>
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  requestSettingsOpen("policy");
                }}
                className="text-aomi-accent-strong hover:text-aomi-fg shrink-0 font-medium transition-colors"
              >
                Change
              </button>
            </div>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
};
