"use client";

import {
  ArrowDownIcon,
  ArrowUpIcon,
  BoxIcon,
  CableIcon,
  CheckIcon,
  CoinsIcon,
  CopyIcon,
  ImageIcon,
  LandmarkIcon,
  LoaderCircleIcon,
  PencilIcon,
  PlusIcon,
  RefreshCwIcon,
  SearchIcon,
  SendIcon,
  ShieldCheckIcon,
  Square,
  ArrowLeftRightIcon,
  TrendingUpIcon,
} from "lucide-react";

import {
  ActionBarPrimitive,
  ComposerPrimitive,
  ErrorPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
} from "@assistant-ui/react";

import type { FC, FormEvent } from "react";
import { memo, useEffect, useRef, useState } from "react";
import { LazyMotion, MotionConfig, domMax } from "motion/react";
import * as m from "motion/react-m";

import { Button } from "@/ui/button";
import { AomiButton } from "@/ui/aomi/button";
import { Skeleton } from "@/ui/skeleton";
import { MarkdownText } from "./markdown-text";
import { ToolFallback } from "./tool-fallback";
import { AssistantTurnParts } from "./working-trace";
import { isWorkLimitPause } from "./notice-codes";
import { TooltipIconButton } from "./tooltip-icon-button";

import {
  cn,
  useOptionalAomiRuntime,
  useThreadContext,
  useThreadTaskRuns,
} from "@aomi-labs/react";
import { AppIndicator } from "@/controls/app-indicator";
import { useComposerControl } from "@/frame/aomi-frame";
import { AomiMark } from "@/ui/aomi-mark";
import { AssistantMessageRow } from "./assistant-message-row";
import { ActivitySidebar } from "@/sidebar/activity/activity-sidebar";
import { ModelSelect } from "@/controls/model-select";
import { AppSecretsDialog } from "@/account/app-secrets/app-secrets-dialog";
import {
  SafetySelect,
  ThreadSafetyProvider,
  useThreadSafety,
} from "@/controls/safety-select";
import { ApiKeyInput } from "@/controls/api-key-input";
import { NetworkSelect } from "@/controls/network-select";
import { ConnectButton } from "@/wallet/connect-button";
import { PaymentRequiredGate } from "@/controls/payment-required-gate";
import { CapabilityMessageText } from "./capability-message-text";
import {
  useThread,
  useComposerRuntime,
  useMessage,
  useThreadRuntime,
} from "@assistant-ui/react";
import {
  CapabilityComposerProvider,
  useCapabilityComposer,
} from "@/composer/capability-composer/provider";
import { CapabilityMentionInput } from "@/composer/capability-composer/input";

import { TraceAttributionProvider } from "./trace-attribution";
import { testIds } from "@/test-ids";
import { useChatScroll } from "./use-chat-scroll";

export const Thread: FC = () => {
  const runtime = useOptionalAomiRuntime();
  return (
    <ThreadBody
      hasRuntime={Boolean(runtime)}
      isReviewingAction={Boolean(runtime?.pendingActions.length)}
    />
  );
};

// Runtime events still reach native messages and activity directly. The static
// transcript providers need only these two runtime conditions from the parent.
const ThreadBody = memo(function ThreadBody({
  hasRuntime,
  isReviewingAction,
}: {
  hasRuntime: boolean;
  isReviewingAction: boolean;
}) {
  const loading = useThread((thread) => thread.isLoading);
  const { restoring, autoScroll, viewportProps } = useChatScroll(loading);
  const composerControl = useComposerControl();
  const controlBarProps = composerControl.controlBarProps ?? {};

  return (
    <CapabilityComposerProvider
      enabledAppIds={controlBarProps.enabledAppIds}
      routing={controlBarProps.routing}
      initialAppTag={controlBarProps.initialAppTag}
    >
      <ThreadSafetyProvider
        enabled={composerControl.enabled && !controlBarProps.hideSafety}
      >
        <TraceAttributionProvider>
          <LazyMotion features={domMax}>
            <MotionConfig reducedMotion="user">
              <ThreadPrimitive.Root
                data-restoring={restoring || undefined}
                className="aui-root aui-thread-root @container bg-aomi-bg text-aomi-fg relative flex h-full flex-col data-[restoring]:[&_.animate-in]:animate-none"
                style={{
                  ["--thread-max-width" as string]: "45rem",
                }}
              >
                <PaymentRequiredGate />
                <div className="@[900px]:flex-row relative flex min-h-0 flex-1 flex-col overflow-hidden">
                  <div className="aui-chat-column @[900px]:ml-auto @[900px]:max-w-[var(--activity-chat-max-width,100%)] flex min-h-0 min-w-0 max-w-full flex-1 flex-col">
                    <ThreadPrimitive.Viewport
                      {...viewportProps}
                      autoScroll={!isReviewingAction && autoScroll}
                      data-testid={testIds.messageList}
                      className="aui-thread-viewport relative flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden px-4 pt-2 md:px-6"
                    >
                      <ThreadPrimitive.If empty>
                        <ThreadWelcome />
                      </ThreadPrimitive.If>

                      <ThreadPrimitive.Messages
                        components={{
                          UserMessage,
                          EditComposer,
                          AssistantMessage,
                        }}
                      />

                      <ThreadPrimitive.If empty={false}>
                        <div className="aui-thread-viewport-spacer min-h-36 grow" />
                      </ThreadPrimitive.If>
                    </ThreadPrimitive.Viewport>

                    {/* The empty state carries its own hero composer (mock layout); the
              docked composer appears once a conversation exists. */}
                    <ThreadPrimitive.If empty={false}>
                      <Composer />
                    </ThreadPrimitive.If>
                  </div>
                  {hasRuntime && <ActivitySidebar />}
                </div>
              </ThreadPrimitive.Root>
            </MotionConfig>
          </LazyMotion>
        </TraceAttributionProvider>
      </ThreadSafetyProvider>
    </CapabilityComposerProvider>
  );
});

const ThreadScrollToBottom: FC = () => {
  return (
    <ThreadPrimitive.ScrollToBottom asChild>
      <TooltipIconButton
        tooltip="Scroll to bottom"
        variant="outline"
        className="aui-thread-scroll-to-bottom dark:bg-background dark:hover:bg-accent absolute -top-12 z-10 self-center rounded-full p-4 disabled:invisible"
      >
        <ArrowDownIcon />
      </TooltipIconButton>
    </ThreadPrimitive.ScrollToBottom>
  );
};

const ThreadWelcome: FC = () => {
  const isLoading = useThread((t) => t.isLoading);
  const runtime = useOptionalAomiRuntime();
  const { welcomeTitle = "What should happen on-chain?", opening } =
    useComposerControl();

  // A saved chat on its way in shows nothing rather than a new chat.
  if (isLoading || opening) return null;
  // A saved chat whose history failed is not a new chat: no hero, no composer.
  if (runtime?.threadLoadError)
    return <ThreadLoadError onRetry={runtime.retryThreadLoad} />;

  return (
    <div className="aui-thread-welcome-root mx-auto my-auto flex w-full max-w-[var(--thread-max-width)] flex-col items-center justify-center gap-6 px-4">
      <m.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 10 }}
        className="aui-thread-welcome-message flex flex-col items-center gap-4"
      >
        <AomiMark size={52} className="text-aomi-fg" />
        <h1 className="aui-thread-welcome-title text-aomi-fg text-center text-[30px] font-normal tracking-[-0.02em]">
          {welcomeTitle}
        </h1>
      </m.div>
      <m.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 10 }}
        transition={{ delay: 0.05 }}
        className="w-full"
      >
        <ComposerBox placeholder="Ask Aomi to swap, bridge, send, or deploy…" />
      </m.div>
      <ThreadSuggestions />
    </div>
  );
};

const ThreadLoadError: FC<{ onRetry?: () => void }> = ({ onRetry }) => (
  <div className="aui-thread-load-error-root mx-auto my-auto flex w-full max-w-[var(--thread-max-width)] flex-col items-center px-4">
    <div
      role="alert"
      data-testid={testIds.threadLoadError}
      className="aui-assistant-notice aui-thread-load-error bg-aomi-surface text-aomi-fg border-aomi-border w-full max-w-sm rounded-2xl border px-4 py-3 text-sm"
    >
      <div className="aui-assistant-notice-title mb-1 font-medium">
        Couldn&apos;t load this conversation
      </div>
      <div className="aui-assistant-notice-message text-aomi-muted leading-5">
        Check your connection and try again.
      </div>
      {onRetry && (
        <AomiButton
          size="sm"
          className="mt-3"
          data-testid={testIds.threadLoadRetry}
          onClick={onRetry}
        >
          Retry
        </AomiButton>
      )}
    </div>
  </div>
);

const ThreadSuggestions: FC = () => {
  const composerRuntime = useComposerRuntime();
  const { sendDisabled } = useComposerControl();
  const safety = useThreadSafety();
  const suggestionRows = [
    {
      id: "primary",
      actions: [
        {
          label: "Swap 0.5 ETH to USDC",
          action: "Swap 0.5 ETH to USDC at the best rate",
          icon: ArrowLeftRightIcon,
        },
        {
          label: "Bridge USDC to Base",
          action: "Bridge 100 USDC from Ethereum to Base",
          icon: CableIcon,
        },
        {
          label: "Check my portfolio",
          action: "Show my wallet balances and positions",
          icon: CoinsIcon,
        },
        {
          label: "Deploy an ERC-20 token",
          action: "Deploy an ERC-20 token",
          icon: BoxIcon,
        },
        {
          label: "Find the best ETH yield",
          action: "Find the highest available yield for staking ETH",
          icon: TrendingUpIcon,
        },
      ],
    },
    {
      id: "secondary",
      actions: [
        {
          label: "Send 0.01 ETH",
          action: "Help me send 0.01 ETH to another wallet",
          icon: SendIcon,
        },
        {
          label: "Supply USDC to Aave",
          action: "Supply 100 USDC to Aave on the best supported network",
          icon: LandmarkIcon,
        },
        {
          label: "Review token approvals",
          action: "Show and review my active token approvals",
          icon: ShieldCheckIcon,
        },
        {
          label: "Create an NFT collection",
          action: "Create and deploy an NFT collection",
          icon: ImageIcon,
        },
        {
          label: "Track a transaction",
          action: "Help me look up an on-chain transaction by hash",
          icon: SearchIcon,
        },
      ],
    },
  ];

  return (
    <div className="aui-thread-welcome-suggestions w-full overflow-visible pb-4">
      {suggestionRows.map((row, rowIndex) => (
        <div
          key={row.id}
          className={cn(
            "aui-thread-welcome-suggestions-track w-full",
            rowIndex === 1 &&
              "aui-thread-welcome-suggestions-track-secondary hidden",
          )}
          aria-hidden={rowIndex === 1 || undefined}
        >
          {[false, true].map((duplicate) => (
            <div
              key={duplicate ? "duplicate" : "primary"}
              className={cn(
                "aui-thread-welcome-suggestions-group flex w-full flex-wrap justify-center gap-2.5",
                duplicate && "aui-thread-welcome-suggestions-duplicate hidden",
              )}
              aria-hidden={duplicate || undefined}
            >
              {row.actions.map((suggestedAction, index) => (
                <m.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 20 }}
                  transition={{ delay: 0.05 * index }}
                  key={`suggested-action-${row.id}-${duplicate ? "duplicate" : "primary"}-${suggestedAction.label}`}
                  className={cn(
                    "aui-thread-welcome-suggestion-display @max-md:[&:nth-child(n+3)]:hidden",
                    index === 4 && "aui-thread-welcome-suggestion-extra hidden",
                  )}
                >
                  <ThreadPrimitive.Suggestion
                    prompt={suggestedAction.action}
                    send
                    asChild
                    onClick={(event) => {
                      if (sendDisabled) return event.preventDefault();
                      // A held safety level must be saved before turn one.
                      if (!safety?.hasHeld()) return;
                      event.preventDefault();
                      void safety.commitHeld().then((saved) => {
                        if (!saved) return;
                        composerRuntime.setText(suggestedAction.action);
                        composerRuntime.send();
                      });
                    }}
                  >
                    <button
                      type="button"
                      tabIndex={rowIndex === 1 || duplicate ? -1 : undefined}
                      className="aui-thread-welcome-suggestion border-aomi-border bg-aomi-surface text-aomi-fg hover:border-aomi-muted/40 flex items-center gap-2 whitespace-nowrap rounded-full border px-3.5 py-[9px] text-[13px] transition-colors"
                      aria-label={suggestedAction.action}
                    >
                      <suggestedAction.icon className="text-aomi-accent size-[15px] shrink-0" />
                      {suggestedAction.label}
                    </button>
                  </ThreadPrimitive.Suggestion>
                </m.div>
              ))}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
};

/**
 * The composer input box, shared between the centered hero (empty thread) and
 * the bottom dock (active thread). Same runtime composer either way — only the
 * placement and placeholder differ.
 */
const ComposerBox: FC<{ placeholder: string }> = ({ placeholder }) => {
  const { prepareSubmit } = useCapabilityComposer();
  const { sendDisabled } = useComposerControl();
  const runtime = useOptionalAomiRuntime();
  const composer = useComposerRuntime();
  const safety = useThreadSafety();
  const committing = useRef(false);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    if (sendDisabled) return event.preventDefault();
    prepareSubmit(event);
    const active = runtime?.turnControl
      ? Boolean(runtime.turnControl.active_turn_id)
      : runtime?.turnState === "processing" ||
        runtime?.turnState === "awaiting_action";
    if (!event.defaultPrevented && active && runtime?.supportsSteering) {
      event.preventDefault();
      const text = composer.getState().text.trim();
      if (!text) return;
      const threadId = runtime.currentThreadId;
      composer.setText("");
      void runtime.sendMessage(text).catch((error: unknown) => {
        if (
          runtime.currentThreadId === threadId &&
          !composer.getState().text.trim()
        )
          composer.setText(text);
        runtime.showNotification({
          type: "error",
          title: "Update not accepted",
          message:
            error instanceof Error
              ? error.message
              : "Your text has been kept for resubmission.",
        });
      });
      return;
    }
    if (event.defaultPrevented || !safety?.hasHeld()) return;
    // Save a new chat's held safety level first so turn one runs under it.
    event.preventDefault();
    // Another Enter during that save waits for it; only the first resubmits.
    if (committing.current) return;
    committing.current = true;
    const form = event.currentTarget;
    void safety.commitHeld().then((saved) => {
      committing.current = false;
      if (saved) form.requestSubmit();
    });
  };
  return (
    <ComposerPrimitive.Root
      onSubmit={submit}
      data-testid={testIds.composer}
      className="aui-composer-root border-aomi-border bg-aomi-surface relative flex w-full flex-col rounded-2xl border pt-3 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_4px_14px_rgba(0,0,0,0.04)] transition-shadow duration-[180ms] focus-within:shadow-[0_1px_2px_rgba(0,0,0,0.05),0_8px_24px_rgba(0,0,0,0.07)]"
    >
      <CapabilityMentionInput
        placeholder={placeholder}
        className="aui-composer-input text-aomi-fg placeholder:text-aomi-muted max-h-32 w-full resize-none overflow-x-hidden whitespace-pre-wrap break-words bg-transparent px-4 pb-2 pt-1.5 text-[13px] outline-none"
      />
      <ComposerAction />
      <TurnInputStatus />
      <ComposerSafetyStatus />
    </ComposerPrimitive.Root>
  );
};

const TurnInputStatus: FC = () => {
  const runtime = useOptionalAomiRuntime();
  const inputs = runtime?.turnInputs ?? [];
  const latest = inputs.findLast((input) => input.operation === "steer");
  const status = latest?.status;
  const queued = runtime?.turnControl?.queued_turn_ids ?? [];
  const label =
    status === "sending"
      ? "Sending update…"
      : status === "accepted"
        ? "Update accepted · waiting for the current step"
        : status === "applied"
          ? "Update applied"
          : status === "uncertain"
            ? "Update receipt unknown · check the conversation before retrying"
            : status === "rejected"
              ? "Update not accepted · your text is available to resend"
              : status === "superseded" || status === "cancelled"
                ? "Update was not applied"
                : undefined;
  if (!label && queued.length === 0) return null;
  return (
    <div className="text-aomi-muted px-4 pb-2 text-xs">
      {label && <p role="status">{label}</p>}
      {(latest?.status === "rejected" || latest?.status === "uncertain") && (
        <p className="mt-1 break-words">{latest.message}</p>
      )}
      {queued.map((turnId) => {
        const input = inputs.find((item) => item.receipt?.turn_id === turnId);
        return (
          <div
            key={turnId}
            className="mt-2 flex items-center justify-between gap-2"
          >
            <span>Queued: {input?.message ?? "New request"}</span>
            <button
              type="button"
              className="text-aomi-fg underline"
              onClick={() =>
                void runtime?.cancelTurn?.(turnId).catch((error: unknown) =>
                  runtime?.showNotification({
                    type: "error",
                    title: "Couldn’t cancel queued request",
                    message:
                      error instanceof Error ? error.message : "Try again.",
                  }),
                )
              }
            >
              Cancel queued request
            </button>
          </div>
        );
      })}
    </div>
  );
};

/** Pending save of a held safety level, or why the first send was blocked. */
const ComposerSafetyStatus: FC = () => {
  const safety = useThreadSafety();
  if (!safety || safety.started) return null;
  if (safety.pending && safety.busy)
    return (
      <p role="status" className="text-aomi-muted px-4 pb-3 text-[12px]">
        Setting this chat&apos;s safety level…
      </p>
    );
  if (safety.pending && safety.error)
    return (
      <p
        role="alert"
        className="text-aomi-danger break-words px-4 pb-3 text-[12px]"
      >
        {safety.error}
      </p>
    );
  return null;
};

const Composer: FC = () => {
  return (
    <div className="aui-composer-wrapper bg-aomi-bg mx-auto flex w-full max-w-[var(--thread-max-width)] shrink-0 flex-col gap-4 overflow-visible px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-1 md:pb-6">
      <ThreadScrollToBottom />
      <ComposerBox placeholder="Reply to Aomi…" />
    </div>
  );
};

const CapabilityPickerButton: FC = () => {
  const { hintsEnabled, openCapabilityPicker } = useCapabilityComposer();
  if (!hintsEnabled) return null;

  return (
    <button
      type="button"
      aria-label="Add app, skill, or chain"
      title="Add app, skill, or chain"
      onMouseDown={(event) => event.preventDefault()}
      onClick={openCapabilityPicker}
      className="text-aomi-muted hover:bg-aomi-hover hover:text-aomi-fg flex size-8 shrink-0 items-center justify-center rounded-lg transition-colors"
    >
      <PlusIcon className="size-4" />
    </button>
  );
};

const ComposerAction: FC = () => {
  const composerControl = useComposerControl();
  const aomiRuntime = useOptionalAomiRuntime();
  const composer = useComposerRuntime();
  const nativeRunning = useThread((thread) => thread.isRunning);
  const active = aomiRuntime?.turnControl
    ? Boolean(aomiRuntime.turnControl.active_turn_id)
    : nativeRunning || aomiRuntime?.turnState === "awaiting_action";
  const controlBarProps = composerControl.controlBarProps ?? {};
  const hideModel = controlBarProps.hideModel ?? false;
  const hideSafety = controlBarProps.hideSafety ?? false;
  const hideApiKey = controlBarProps.hideApiKey ?? false;
  const hideWallet = controlBarProps.hideWallet ?? true;
  const hideNetwork = controlBarProps.hideNetwork ?? false;
  const hideAppSecrets = controlBarProps.hideAppSecrets ?? false;
  const { hostError, selectedApp } = useCapabilityComposer();
  const safety = useThreadSafety();
  const committingSafety = Boolean(safety?.pending && safety.busy);

  return (
    <div className="aui-composer-action-wrapper relative mx-1 mb-3 mt-2 flex min-h-[38px] items-center gap-1">
      {/* Inline controls — horizontally scrollable on mobile */}
      {composerControl.enabled && (
        <div className="aui-composer-action-scroll ml-1 flex min-w-0 flex-1 items-center gap-0 overflow-x-auto md:ml-2">
          {!hideNetwork && <NetworkSelect />}
          <CapabilityPickerButton />
          {!hideModel && <ModelSelect />}
          {!hideSafety && <SafetySelect />}
          <AppIndicator app={selectedApp ?? undefined} />
          {/* Renders only when the directly targeted app asks the signed-in
              user for app credentials. */}
          {!hideAppSecrets && <AppSecretsDialog />}
          {!hideWallet && <ConnectButton />}
          {!hideApiKey && <ApiKeyInput />}
        </div>
      )}

      {/* Spacer — only when no inline controls */}
      {!composerControl.enabled && <div className="flex-1" />}

      <div className="flex shrink-0 items-center gap-2">
        {active && aomiRuntime?.supportsSteering && (
          <>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                const text = composer.getState().text.trim();
                if (!text || !aomiRuntime.queueMessage) return;
                composer.setText("");
                void aomiRuntime.queueMessage(text).catch((error: unknown) => {
                  if (!composer.getState().text.trim()) composer.setText(text);
                  aomiRuntime.showNotification({
                    type: "error",
                    title: "Request not queued",
                    message:
                      error instanceof Error
                        ? error.message
                        : "Your text has been kept.",
                  });
                });
              }}
            >
              Queue new request
            </Button>
            <Button
              type="submit"
              variant="default"
              size="sm"
              aria-label="Update current request"
              disabled={
                Boolean(hostError) || Boolean(composerControl.sendDisabled)
              }
            >
              Update current request
            </Button>
          </>
        )}
        {!active && (
          <>
            <ComposerPrimitive.Send asChild>
              <Button
                type="submit"
                variant="default"
                size="icon"
                data-testid={testIds.send}
                className="aui-composer-send bg-aomi-fg text-aomi-bg hover:bg-aomi-fg mr-2 size-8 shrink-0 rounded-full p-1 transition-opacity hover:opacity-90 md:mr-2.5"
                aria-label="Send message"
                disabled={
                  Boolean(hostError) ||
                  committingSafety ||
                  Boolean(composerControl.sendDisabled)
                }
                title={hostError ?? undefined}
              >
                <ArrowUpIcon className="aui-composer-send-icon size-4" />
              </Button>
            </ComposerPrimitive.Send>
          </>
        )}

        {active && (
          <>
            <ComposerPrimitive.Cancel asChild>
              <Button
                type="button"
                variant="default"
                size="icon"
                data-testid={testIds.stop}
                className="aui-composer-cancel bg-aomi-fg text-aomi-bg hover:bg-aomi-fg mr-2 size-8 shrink-0 rounded-full transition-opacity hover:opacity-90 md:mr-2.5"
                aria-label={
                  aomiRuntime?.isStopping
                    ? "Stopping generation"
                    : "Stop generating"
                }
                aria-busy={Boolean(aomiRuntime?.isStopping)}
                disabled={Boolean(aomiRuntime?.isStopping)}
                onClick={
                  aomiRuntime
                    ? (event) => {
                        event.preventDefault();
                        aomiRuntime.cancelGeneration();
                      }
                    : undefined
                }
              >
                {aomiRuntime?.isStopping ? (
                  <LoaderCircleIcon className="size-4 animate-spin motion-reduce:animate-none" />
                ) : (
                  <Square className="aui-composer-cancel-icon fill-aomi-bg size-3" />
                )}
              </Button>
            </ComposerPrimitive.Cancel>
          </>
        )}
      </div>
    </div>
  );
};

const MessageError: FC = () => {
  return (
    <MessagePrimitive.Error>
      <ErrorPrimitive.Root className="aui-message-error-root border-destructive bg-destructive/10 text-destructive dark:bg-destructive/5 mt-2 rounded-md border p-3 text-sm dark:text-red-200">
        <ErrorPrimitive.Message className="aui-message-error-message line-clamp-2" />
      </ErrorPrimitive.Root>
    </MessagePrimitive.Error>
  );
};

const AssistantLoadingDot: FC = () => {
  return (
    <div
      role="status"
      aria-label="Waiting for response"
      className="aui-assistant-loading-dot-wrapper flex min-h-6 items-center px-1"
    >
      <span className="aui-assistant-loading-dot bg-aomi-fg block size-2.5 animate-pulse rounded-full" />
    </div>
  );
};

const AssistantMessage: FC = () => {
  const taskRuns = useThreadTaskRuns();
  const hasLiveTaskRun = Object.values(taskRuns).some(
    (run) => run.status === "running",
  );
  // The dot covers only the send itself, until the backend accepts the turn;
  // the working trace's Thinking takes over from there.
  const runtime = useOptionalAomiRuntime();
  const isSending = Boolean(runtime?.isSubmitting || runtime?.isStartUncertain);
  return (
    <AssistantMessageBody
      hasLiveTaskRun={hasLiveTaskRun}
      isSending={isSending}
    />
  );
};

const AssistantMessageBody = memo(function AssistantMessageBody({
  hasLiveTaskRun,
  isSending,
}: {
  hasLiveTaskRun: boolean;
  isSending: boolean;
}) {
  const isEmpty = useMessage((state) => state.content.length === 0);
  const isRunning = useMessage((state) => state.status?.type === "running");
  const isLast = useMessage((state) => state.isLast);
  const notice = useMessage((state) => state.metadata?.custom) as
    | {
        aomiNoticeKind?: string;
        aomiNoticeTitle?: string;
        aomiNoticeCode?: string;
      }
    | undefined;
  // Notices are runtime records, not model turns: a payment gate, or a turn
  // the app failed to answer. They share one card treatment; only the accent
  // and the default title differ.
  const noticeKind = notice?.aomiNoticeKind;
  const isNotice = noticeKind === "payment_required" || noticeKind === "error";
  // The work limit pauses a turn; it did not fail.
  const isPausedNotice = isNotice && isWorkLimitPause(notice?.aomiNoticeCode);
  const isErrorNotice = noticeKind === "error" && !isPausedNotice;
  const showLoadingDot =
    isEmpty && isRunning && isLast && isSending && !hasLiveTaskRun;
  const showFinishedEmptyMessage = isEmpty && !isRunning;

  return (
    <MessagePrimitive.Root asChild>
      <div
        className={cn(
          "aui-assistant-message-root animate-in fade-in slide-in-from-bottom-1 relative mx-auto w-full max-w-[var(--thread-max-width)] duration-150 ease-out",
          showFinishedEmptyMessage ? "-mt-3 py-0" : "py-4",
        )}
        data-role="assistant"
        data-testid={testIds.assistantMessage}
      >
        <AssistantMessageRow showMark={!showFinishedEmptyMessage}>
          <div className="aui-assistant-message-col min-w-0 flex-1">
            {!showFinishedEmptyMessage && isNotice && (
              <div
                data-testid={testIds.notice}
                className={cn(
                  "aui-assistant-notice bg-aomi-surface text-aomi-fg rounded-2xl border px-4 py-3 text-sm",
                  isErrorNotice
                    ? "aui-assistant-notice-error border-destructive/40"
                    : isPausedNotice
                      ? "aui-assistant-notice-paused border-aomi-border"
                      : "aui-assistant-payment-required border-aomi-border",
                )}
              >
                <div className="aui-assistant-notice-title mb-1 font-medium">
                  {isPausedNotice
                    ? "Paused at the work time limit"
                    : (notice?.aomiNoticeTitle ??
                      (isErrorNotice ? "Error" : "Credits needed"))}
                </div>
                <div className="aui-assistant-notice-message text-aomi-muted leading-5">
                  {isPausedNotice ? (
                    "Finished steps are saved."
                  ) : (
                    <MessagePrimitive.Parts
                      components={{
                        Text: MarkdownText,
                        tools: { Fallback: ToolFallback },
                      }}
                    />
                  )}
                </div>
                {isPausedNotice && isLast && <ContinueAfterPause />}
              </div>
            )}

            {!showFinishedEmptyMessage && !isNotice && (
              <div className="aui-assistant-message-content text-aomi-fg break-words text-[15px] leading-[23px]">
                {showLoadingDot ? (
                  <AssistantLoadingDot />
                ) : (
                  <AssistantTurnParts />
                )}
                <MessageError />
              </div>
            )}

            {!showLoadingDot && (
              <div
                className={cn(
                  "aui-assistant-message-footer flex",
                  showFinishedEmptyMessage ? "mt-0" : "mt-2",
                )}
              >
                <AssistantActionBar />
              </div>
            )}
          </div>
        </AssistantMessageRow>
      </div>
    </MessagePrimitive.Root>
  );
});

/** Sends the follow-up that picks a paused turn back up. */
const ContinueAfterPause: FC = () => {
  const thread = useThreadRuntime();
  const running = useThread((state) => state.isRunning);
  const { sendDisabled } = useComposerControl();
  return (
    <AomiButton
      size="sm"
      className="mt-3"
      disabled={running || sendDisabled}
      data-testid={testIds.continueAfterPause}
      onClick={() =>
        thread.append({
          role: "user",
          content: [{ type: "text", text: "Continue" }],
        })
      }
    >
      Continue
    </AomiButton>
  );
};

function useTouchActions() {
  const [touchActions, setTouchActions] = useState(false);
  useEffect(() => {
    const media = window.matchMedia("(hover: none), (pointer: coarse)");
    const update = () => setTouchActions(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return touchActions;
}

const AssistantActionBar: FC = () => {
  const touchActions = useTouchActions();
  return (
    <ActionBarPrimitive.Root
      hideWhenRunning
      autohide={touchActions ? "never" : "not-last"}
      autohideFloat="single-branch"
      className="aui-assistant-action-bar-root text-aomi-muted data-floating:absolute data-floating:rounded-xl data-floating:border data-floating:bg-aomi-raised data-floating:p-1 flex items-center gap-3.5 pt-0.5"
    >
      <ActionBarPrimitive.Copy asChild>
        <Button
          variant="ghost"
          size="icon"
          className="aui-button-icon hover:text-aomi-fg size-5 p-0 transition-colors hover:bg-transparent"
          aria-label="Copy"
        >
          <MessagePrimitive.If copied>
            <CheckIcon className="size-[15px]" />
          </MessagePrimitive.If>
          <MessagePrimitive.If copied={false}>
            <CopyIcon className="size-[15px]" />
          </MessagePrimitive.If>
        </Button>
      </ActionBarPrimitive.Copy>
      <ActionBarPrimitive.Reload asChild>
        <Button
          variant="ghost"
          size="icon"
          className="aui-button-icon hover:text-aomi-fg size-5 p-0 transition-colors hover:bg-transparent"
          aria-label="Rerun"
          data-testid={testIds.rerun}
        >
          <RefreshCwIcon className="size-[15px]" />
        </Button>
      </ActionBarPrimitive.Reload>
    </ActionBarPrimitive.Root>
  );
};

const UserMessage: FC = () => {
  const isEmpty = useMessage((state) => state.content.length === 0);
  const sendFailure = useMessage((state) => {
    const custom = state.metadata?.custom as
      | { aomiSendStatus?: string; aomiSendError?: string }
      | undefined;
    return custom?.aomiSendStatus === "failed"
      ? (custom.aomiSendError ?? "Message failed to send")
      : null;
  });

  return (
    <MessagePrimitive.Root asChild>
      <div
        className="aui-user-message-root animate-in fade-in slide-in-from-bottom-1 mx-auto grid w-full max-w-[var(--thread-max-width)] auto-rows-auto grid-cols-[minmax(28px,1fr)_minmax(0,auto)] gap-y-2 px-2 py-4 duration-150 ease-out first:mt-3 last:mb-5 md:grid-cols-[minmax(72px,1fr)_minmax(0,auto)] [&:where(>*)]:col-start-2"
        data-role="user"
        data-testid={testIds.userMessage}
      >
        <div className="aui-user-message-content-wrapper relative col-start-2 min-w-0 max-w-[32rem] justify-self-end">
          <div className="aui-user-message-content bg-aomi-surface-2 text-aomi-fg rounded-2xl rounded-br-md px-[15px] py-[11px] text-[15px] leading-[22px] [overflow-wrap:anywhere]">
            {isEmpty ? (
              <Skeleton className="aui-user-message-content-skeleton h-4 w-28 rounded-full" />
            ) : (
              <MessagePrimitive.Parts
                components={{ Text: CapabilityMessageText }}
              />
            )}
          </div>
          {!isEmpty && (
            <div className="aui-user-action-bar-wrapper absolute left-0 top-1/2 -translate-x-full -translate-y-1/2 pr-2">
              <UserActionBar />
            </div>
          )}
        </div>

        {sendFailure && (
          <p
            role="alert"
            className="aui-user-message-error text-destructive col-start-2 max-w-[32rem] justify-self-end text-xs"
          >
            Message wasn&apos;t sent. {sendFailure}
          </p>
        )}
      </div>
    </MessagePrimitive.Root>
  );
};

const UserActionBar: FC = () => {
  const touchActions = useTouchActions();
  return (
    <ActionBarPrimitive.Root
      hideWhenRunning
      autohide={touchActions ? "never" : "always"}
      className="aui-user-action-bar-root flex flex-col items-end"
    >
      <ActionBarPrimitive.Edit asChild>
        <Button
          variant="ghost"
          size="icon"
          className="aui-button-icon aui-user-action-edit text-aomi-muted hover:text-aomi-fg size-7 rounded-lg p-0 transition-colors hover:bg-transparent"
          aria-label="Edit"
          data-testid={testIds.editMessage}
        >
          <PencilIcon className="size-3.5" />
        </Button>
      </ActionBarPrimitive.Edit>
    </ActionBarPrimitive.Root>
  );
};

const EditComposer: FC = () => {
  return (
    <div className="aui-edit-composer-wrapper mx-auto flex w-full max-w-[var(--thread-max-width)] flex-col gap-4 px-2 first:mt-4">
      <ComposerPrimitive.Root className="aui-edit-composer-root max-w-7/8 bg-aomi-surface-2 ml-auto flex w-full flex-col rounded-2xl">
        <ComposerPrimitive.Input
          aria-label="Edit message"
          className="aui-edit-composer-input text-foreground flex min-h-[60px] w-full resize-none bg-transparent p-4 outline-none dark:text-white"
          autoFocus
        />

        <div className="aui-edit-composer-footer mx-3 mb-3 flex items-center justify-center gap-2 self-end">
          <ComposerPrimitive.Cancel asChild>
            <Button variant="ghost" size="sm" aria-label="Cancel edit">
              Cancel
            </Button>
          </ComposerPrimitive.Cancel>
          <ComposerPrimitive.Send asChild>
            <Button size="sm" aria-label="Save and resend">
              Save and resend
            </Button>
          </ComposerPrimitive.Send>
        </div>
      </ComposerPrimitive.Root>
    </div>
  );
};
