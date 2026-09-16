"use client";

import {
  ArrowDownIcon,
  ArrowUpIcon,
  BoxIcon,
  CableIcon,
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CoinsIcon,
  CopyIcon,
  PencilIcon,
  RefreshCwIcon,
  Square,
  ArrowLeftRightIcon,
  TrendingUpIcon,
} from "lucide-react";

import {
  ActionBarPrimitive,
  BranchPickerPrimitive,
  ComposerPrimitive,
  ErrorPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
} from "@assistant-ui/react";

import type { FC } from "react";
import { useEffect } from "react";
import { LazyMotion, MotionConfig, domAnimation } from "motion/react";
import * as m from "motion/react-m";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { MarkdownText } from "@/components/assistant-ui/markdown-text";
import { ToolFallback } from "@/components/assistant-ui/tool-fallback";
import { AssistantTurnParts } from "@/components/assistant-ui/working-trace";
import { TooltipIconButton } from "@/components/assistant-ui/tooltip-icon-button";

import {
  cn,
  useOptionalAomiRuntime,
  useThreadContext,
  useThreadTaskRuns,
} from "@aomi-labs/react";
import { useComposerControl } from "@/components/aomi-frame";
import { AomiMark } from "@/components/aomi-mark";
import { ModelSelect } from "@/components/control-bar/model-select";
import { AppSelect } from "@/components/control-bar/app-select";
import { ApiKeyInput } from "@/components/control-bar/api-key-input";
import { NetworkSelect } from "@/components/control-bar/network-select";
import { ConnectButton } from "@/components/control-bar/connect-button";
import { PaymentRequiredGate } from "@/components/control-bar/payment-required-gate";
import { shouldShowThreadLoadingSkeleton } from "@/components/assistant-ui/thread-loading";
import { useThread, useComposerRuntime, useMessage } from "@assistant-ui/react";

export const Thread: FC = () => {
  const composerRuntime = useComposerRuntime();
  const { threadViewKey } = useThreadContext();

  useEffect(() => {
    try {
      composerRuntime.setText("");
    } catch (error) {
      console.error("Failed to reset composer input:", error);
    }
  }, [composerRuntime, threadViewKey]);

  return (
    <LazyMotion features={domAnimation}>
      <MotionConfig reducedMotion="user">
        <ThreadPrimitive.Root
          className="aui-root aui-thread-root @container bg-aomi-bg text-aomi-fg relative flex h-full flex-col"
          style={{
            ["--thread-max-width" as string]: "45rem",
          }}
        >
          <PaymentRequiredGate />
          <ThreadPrimitive.Viewport className="aui-thread-viewport relative flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden px-4 pt-2 md:px-6">
            <ThreadPrimitive.If empty>
              <ThreadWelcome />
            </ThreadPrimitive.If>

            <ThreadLoadingSkeleton />

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
        </ThreadPrimitive.Root>
      </MotionConfig>
    </LazyMotion>
  );
};

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
  const { welcomeTitle = "What should happen on-chain?" } =
    useComposerControl();

  if (isLoading) return null;

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

const ThreadSuggestions: FC = () => {
  const suggestedActions = [
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
  ];
  const suggestionRows = [
    {
      id: "primary",
      actions: suggestedActions,
    },
    {
      id: "secondary",
      actions: [...suggestedActions.slice(2), ...suggestedActions.slice(0, 2)],
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
  return (
    <ComposerPrimitive.Root className="aui-composer-root border-aomi-border bg-aomi-surface relative flex w-full flex-col rounded-2xl border pt-3">
      <ComposerPrimitive.Input
        placeholder={placeholder}
        className="aui-composer-input text-aomi-fg placeholder:text-aomi-muted max-h-32 w-full resize-none overflow-x-hidden whitespace-pre-wrap break-words bg-transparent px-4 pb-2 pt-1.5 text-[13px] outline-none"
        rows={1}
        autoFocus
        aria-label="Message input"
      />
      <ComposerAction />
    </ComposerPrimitive.Root>
  );
};

const Composer: FC = () => {
  return (
    <div className="aui-composer-wrapper bg-aomi-bg mx-auto flex w-full max-w-[var(--thread-max-width)] shrink-0 flex-col gap-4 overflow-visible px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-1 md:pb-6">
      <ThreadScrollToBottom />
      <ComposerBox placeholder="Reply to Aomi…" />
    </div>
  );
};

const ComposerAction: FC = () => {
  const composerControl = useComposerControl();
  const aomiRuntime = useOptionalAomiRuntime();
  const controlBarProps = composerControl.controlBarProps ?? {};
  const hideModel = controlBarProps.hideModel ?? false;
  const hideApp = controlBarProps.hideApp ?? false;
  const hideApiKey = controlBarProps.hideApiKey ?? false;
  const hideWallet = controlBarProps.hideWallet ?? true;
  const hideNetwork = controlBarProps.hideNetwork ?? false;

  return (
    <div className="aui-composer-action-wrapper relative mx-1 mb-3 mt-2 flex min-h-[38px] items-center gap-1">
      {/* Inline controls — horizontally scrollable on mobile */}
      {composerControl.enabled && (
        <div className="aui-composer-action-scroll ml-1 flex min-w-0 flex-1 items-center gap-0 overflow-x-auto md:ml-2 md:gap-2">
          {!hideNetwork && <NetworkSelect />}
          {!hideModel && <ModelSelect />}
          {!hideApp && <AppSelect />}
          {!hideWallet && <ConnectButton />}
          {!hideApiKey && <ApiKeyInput />}
        </div>
      )}

      {/* Spacer — only when no inline controls */}
      {!composerControl.enabled && <div className="flex-1" />}

      <div className="shrink-0">
        <ThreadPrimitive.If running={false}>
          <ComposerPrimitive.Send asChild>
            <Button
              type="submit"
              variant="default"
              size="icon"
              className="aui-composer-send bg-aomi-fg text-aomi-bg hover:bg-aomi-fg mr-2 size-8 shrink-0 rounded-full p-1 transition-opacity hover:opacity-90 md:mr-2.5"
              aria-label="Send message"
            >
              <ArrowUpIcon className="aui-composer-send-icon size-4" />
            </Button>
          </ComposerPrimitive.Send>
        </ThreadPrimitive.If>

        <ThreadPrimitive.If running>
          <ComposerPrimitive.Cancel asChild>
            <Button
              type="button"
              variant="default"
              size="icon"
              className="aui-composer-cancel bg-aomi-fg text-aomi-bg hover:bg-aomi-fg mr-2 size-8 shrink-0 rounded-full transition-opacity hover:opacity-90 md:mr-2.5"
              aria-label="Stop generating"
              onClick={
                aomiRuntime
                  ? (event) => {
                      event.preventDefault();
                      aomiRuntime.cancelGeneration();
                    }
                  : undefined
              }
            >
              <Square className="aui-composer-cancel-icon fill-aomi-bg size-3" />
            </Button>
          </ComposerPrimitive.Cancel>
        </ThreadPrimitive.If>
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

const ThreadLoadingSkeleton: FC = () => {
  const showSkeleton = useThread((t) =>
    shouldShowThreadLoadingSkeleton({
      isLoading: t.isLoading,
      messageCount: t.messages.length,
    }),
  );

  if (!showSkeleton) return null;

  return (
    <div
      role="status"
      aria-label="Loading conversation"
      aria-live="polite"
      className="aui-thread-loading-skeleton mx-auto flex w-full max-w-[var(--thread-max-width)] flex-col gap-3 px-4 py-6"
    >
      <AssistantMessageSkeleton widths={["42%", "68%", "56%"]} />
      <div className="aui-thread-loading-skeleton-status flex items-center gap-2 px-2 pt-1">
        <span className="bg-muted-foreground/30 size-2 animate-pulse rounded-full" />
        <Skeleton className="h-2.5 w-24 rounded-full opacity-60" />
      </div>
    </div>
  );
};

const AssistantMessageSkeleton: FC<{ widths?: string[] }> = ({
  widths = ["72%", "56%", "64%"],
}) => {
  return (
    <div className="aui-assistant-message-skeleton flex flex-col gap-2 px-2">
      {widths.map((width, index) => (
        <Skeleton
          key={`${width}-${index}`}
          className="aui-assistant-message-skeleton-line h-3 rounded-full"
          style={{ width }}
        />
      ))}
    </div>
  );
};

const AssistantLoadingDot: FC = () => {
  return (
    <div className="aui-assistant-loading-dot-wrapper flex min-h-6 items-center px-1">
      <span className="aui-assistant-loading-dot bg-aomi-fg block size-2.5 animate-pulse rounded-full" />
    </div>
  );
};

const AssistantMessage: FC = () => {
  const isEmpty = useMessage((state) => state.content.length === 0);
  const isRunning = useMessage((state) => state.status?.type === "running");
  const isLast = useMessage((state) => state.isLast);
  const runtime = useOptionalAomiRuntime();
  const notice = useMessage((state) => state.metadata?.custom) as
    | { aomiNoticeKind?: string; aomiNoticeTitle?: string }
    | undefined;
  // Notices are runtime records, not model turns: a payment gate, or a turn
  // the app failed to answer. They share one card treatment; only the accent
  // and the default title differ.
  const noticeKind = notice?.aomiNoticeKind;
  const isNotice = noticeKind === "payment_required" || noticeKind === "error";
  const isErrorNotice = noticeKind === "error";
  const taskRuns = useThreadTaskRuns();
  const hasLiveTaskRun = Object.values(taskRuns).some(
    (run) => run.status === "running",
  );
  const showLoadingDot =
    isEmpty &&
    isRunning &&
    isLast &&
    Boolean(runtime?.isSubmitting) &&
    !hasLiveTaskRun;
  const showFinishedEmptyMessage = isEmpty && !isRunning;

  return (
    <MessagePrimitive.Root asChild>
      <div
        className={cn(
          "aui-assistant-message-root animate-in fade-in slide-in-from-bottom-1 relative mx-auto w-full max-w-[var(--thread-max-width)] duration-150 ease-out",
          showFinishedEmptyMessage ? "-mt-3 py-0" : "py-4",
        )}
        data-role="assistant"
      >
        <div className="aui-assistant-message-row flex w-full gap-3 px-3">
          {!showFinishedEmptyMessage && (
            <AomiMark
              size={26}
              className="text-aomi-fg mt-0.5 shrink-0"
              aria-hidden
            />
          )}
          <div className="aui-assistant-message-col min-w-0 flex-1">
            {!showFinishedEmptyMessage && isNotice && (
              <div
                className={cn(
                  "aui-assistant-notice bg-aomi-surface text-aomi-fg rounded-2xl border px-4 py-3 text-sm",
                  isErrorNotice
                    ? "aui-assistant-notice-error border-destructive/40"
                    : "aui-assistant-payment-required border-aomi-border",
                )}
              >
                <div className="aui-assistant-notice-title mb-1 font-medium">
                  {notice?.aomiNoticeTitle ??
                    (isErrorNotice ? "Error" : "Credits needed")}
                </div>
                <div className="aui-assistant-notice-message text-aomi-muted leading-5">
                  <MessagePrimitive.Parts
                    components={{
                      Text: MarkdownText,
                      tools: { Fallback: ToolFallback },
                    }}
                  />
                </div>
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
                <BranchPicker />
                <AssistantActionBar />
              </div>
            )}
          </div>
        </div>
      </div>
    </MessagePrimitive.Root>
  );
};

const AssistantActionBar: FC = () => {
  return (
    <ActionBarPrimitive.Root
      hideWhenRunning
      autohide="not-last"
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
        className="aui-user-message-root animate-in fade-in slide-in-from-bottom-1 mx-auto grid w-full max-w-[var(--thread-max-width)] auto-rows-auto grid-cols-[minmax(72px,1fr)_auto] gap-y-2 px-2 py-4 duration-150 ease-out first:mt-3 last:mb-5 [&:where(>*)]:col-start-2"
        data-role="user"
      >
        <div className="aui-user-message-content-wrapper relative col-start-2 min-w-0 max-w-[32rem] justify-self-end">
          <div className="aui-user-message-content bg-aomi-surface-2 text-aomi-fg break-words rounded-2xl rounded-br-md px-[15px] py-[11px] text-[15px] leading-[22px]">
            {isEmpty ? (
              <Skeleton className="aui-user-message-content-skeleton h-4 w-28 rounded-full" />
            ) : (
              <MessagePrimitive.Parts />
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

        <BranchPicker className="aui-user-branch-picker col-span-full col-start-1 row-start-3 -mr-1 justify-end" />
      </div>
    </MessagePrimitive.Root>
  );
};

const UserActionBar: FC = () => {
  return (
    <ActionBarPrimitive.Root
      hideWhenRunning
      autohide="always"
      className="aui-user-action-bar-root flex flex-col items-end"
    >
      <ActionBarPrimitive.Edit asChild>
        <Button
          variant="ghost"
          size="icon"
          className="aui-button-icon aui-user-action-edit text-aomi-muted hover:text-aomi-fg size-7 rounded-lg p-0 transition-colors hover:bg-transparent"
          aria-label="Edit"
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
            <Button size="sm" aria-label="Update message">
              Update
            </Button>
          </ComposerPrimitive.Send>
        </div>
      </ComposerPrimitive.Root>
    </div>
  );
};

const BranchPicker: FC<BranchPickerPrimitive.Root.Props> = ({
  className,
  ...rest
}) => {
  return (
    <BranchPickerPrimitive.Root
      hideWhenSingleBranch
      className={cn(
        "aui-branch-picker-root text-muted-foreground -ml-2 mr-2 inline-flex items-center text-xs",
        className,
      )}
      {...rest}
    >
      <BranchPickerPrimitive.Previous asChild>
        <TooltipIconButton tooltip="Previous">
          <ChevronLeftIcon />
        </TooltipIconButton>
      </BranchPickerPrimitive.Previous>
      <span className="aui-branch-picker-state font-medium">
        <BranchPickerPrimitive.Number /> / <BranchPickerPrimitive.Count />
      </span>
      <BranchPickerPrimitive.Next asChild>
        <TooltipIconButton tooltip="Next">
          <ChevronRightIcon />
        </TooltipIconButton>
      </BranchPickerPrimitive.Next>
    </BranchPickerPrimitive.Root>
  );
};
