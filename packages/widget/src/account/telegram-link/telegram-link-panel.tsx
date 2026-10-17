"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { CircleX, Clock, Send, Wallet } from "lucide-react";
import {
  TelegramLinkError,
  type AomiClient,
  type TelegramLinkPreview,
  type TelegramLinkResult,
} from "@aomi-labs/client";
import { AomiButton, aomiButton } from "@/ui/aomi/button";
import { AomiSheet } from "@/ui/aomi/aomi-sheet";
import {
  SheetFootnote,
  SheetHeader,
  WaitingButton,
} from "@/wallet/picker/sheet-parts";
import { TelegramMark } from "@/wallet/wallet-brands";

export type TelegramLinkPanelProps = {
  /** A portal-session client; the link routes refuse every other credential. */
  client: AomiClient;
  /** The `/link` code from the page URL; null when it is malformed. */
  code: string | null;
  /** The header's close button once nothing is pending (pending, it cancels). */
  onClose: () => void;
};

type Failure = {
  message: string;
  detail?: string;
  /** What [Try again] repeats; none when trying again cannot help. */
  retry?: "preview" | "confirm";
};

type PanelState =
  | { step: "loading" }
  | { step: "preview"; preview: TelegramLinkPreview }
  | { step: "linking"; preview: TelegramLinkPreview }
  | { step: "linked"; result: TelegramLinkResult; preview: TelegramLinkPreview }
  | { step: "cancelled" }
  | { step: "error"; failure: Failure; preview?: TelegramLinkPreview };

const INVALID = "This link was already used or isn't valid.";
const IN_PROGRESS = "Linking is already in progress.";

const FAILURES: Record<string, string> = {
  link_code_expired: "This link expired. Send /link in the bot again.",
  link_code_used: INVALID,
  link_code_invalid: INVALID,
  invalid_code: INVALID,
  account_has_other_telegram:
    "This account already has a different Telegram linked.",
  account_link_conflict:
    "Both accounts are connected to the same World Markets bot. Revoke one in World first.",
  account_link_busy:
    "A trade from your Telegram account is still being sent. Try again in a minute.",
  link_in_progress: IN_PROGRESS,
  account_merge_in_progress: IN_PROGRESS,
  portal_session_required: "Sign in to Aomi to link Telegram.",
  rate_limited: "Too many tries. Wait a minute and try again.",
};

const plural = (count: number, word: string) =>
  `${count} ${count === 1 ? word : `${word}s`}`;

/** What a refused request means for the person on the page. */
export function telegramLinkFailure(
  error: unknown,
  during: "preview" | "confirm",
): Failure {
  if (!(error instanceof TelegramLinkError))
    return { message: "Couldn’t reach Aomi. Try again.", retry: during };
  if (error.error === "telegram_already_linked")
    return {
      message: error.sameAccount
        ? "This Telegram is already linked to this account."
        : "This Telegram is already linked.",
    };
  if (error.error === "account_link_busy") {
    const sending = error.inFlight.length;
    return {
      // No trade listed: a reply is still being billed.
      message: sending
        ? FAILURES.account_link_busy!
        : "Your Telegram account is still finishing a reply. Try again in a minute.",
      detail: sending
        ? `${plural(sending, "trade")} still being sent.`
        : undefined,
      retry: "confirm",
    };
  }
  const message = FAILURES[error.error];
  return message
    ? { message, retry: error.error === "rate_limited" ? during : undefined }
    : { message: "Something went wrong. Try again.", retry: during };
}

const handleOf = (preview: TelegramLinkPreview) =>
  preview.telegram.username ? `@${preview.telegram.username}` : null;

/** The bot whose `/link` code opened this page, as `@name`. */
const botOf = (preview?: TelegramLinkPreview) => {
  const label = preview?.telegram.linked_from?.label;
  return label?.startsWith("@") ? label : undefined;
};

/** What linking changes, one line each. */
function linkLines(preview: TelegramLinkPreview) {
  const { moves } = preview;
  const lines: { key: string; icon: ReactNode; text: string }[] = [];
  if (moves.agent_wallets.length)
    lines.push({
      key: "wallets",
      icon: <Wallet />,
      text:
        moves.agent_wallets.length === 1
          ? "The Telegram agent wallet joins this account"
          : "The Telegram agent wallets join this account",
    });
  lines.push({
    key: "chats",
    icon: <Clock />,
    text: moves.scheduled_jobs
      ? `Chats stay in the bot; ${plural(moves.scheduled_jobs, "scheduled task")} ${moves.scheduled_jobs === 1 ? "moves" : "move"} here`
      : "Chats stay in the bot",
  });
  if (moves.pending_trades.cancel)
    lines.push({
      key: "cancel",
      icon: <CircleX />,
      text: `${plural(moves.pending_trades.cancel, "trade")} waiting for approval will be cancelled. Nothing was signed.`,
    });
  return lines;
}

/**
 * The `/link/telegram` page's sheet: Link Telegram @x? with what it changes,
 * then Linked (back to the bot). Loading → preview | error; Link → linking →
 * linked | error.
 */
export function TelegramLinkPanel({
  client,
  code,
  onClose,
}: TelegramLinkPanelProps) {
  const [state, setState] = useState<PanelState>(() =>
    code
      ? { step: "loading" }
      : { step: "error", failure: { message: INVALID } },
  );
  const [slow, setSlow] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const load = useCallback(() => {
    if (!code) return () => undefined;
    let stale = false;
    setState({ step: "loading" });
    client.account.telegramLink.previewTelegramLink(code).then(
      (preview) => {
        if (!stale) setState({ step: "preview", preview });
      },
      (error: unknown) => {
        if (!stale)
          setState({
            step: "error",
            failure: telegramLinkFailure(error, "preview"),
          });
      },
    );
    return () => {
      stale = true;
    };
  }, [client, code]);
  useEffect(load, [load]);

  const confirm = async (preview: TelegramLinkPreview | undefined) => {
    if (!code || !preview) return;
    setState({ step: "linking", preview });
    setSlow(false);
    const timer = setTimeout(() => setSlow(true), 3_000);
    try {
      const result =
        await client.account.telegramLink.confirmTelegramLink(code);
      if (mounted.current) setState({ step: "linked", result, preview });
    } catch (error) {
      if (mounted.current)
        setState({
          step: "error",
          failure: telegramLinkFailure(error, "confirm"),
          preview,
        });
    } finally {
      clearTimeout(timer);
    }
  };

  const cancel = async () => {
    if (!code || cancelling) return;
    setCancelling(true);
    try {
      await client.account.telegramLink.cancelTelegramLink(code);
      if (mounted.current) setState({ step: "cancelled" });
    } catch (error) {
      if (mounted.current)
        setState({
          step: "error",
          failure: telegramLinkFailure(error, "preview"),
        });
    } finally {
      if (mounted.current) setCancelling(false);
    }
  };

  const preview = "preview" in state ? state.preview : undefined;
  const bot = botOf(preview);
  const backToBot = bot ? (
    <a
      href={`https://t.me/${bot.slice(1)}`}
      className={`${aomiButton({ variant: "primary" })} h-10 w-full`}
    >
      <Send />
      Back to {bot}
    </a>
  ) : null;
  const pending = state.step === "preview" || state.step === "linking";
  const handle = preview ? handleOf(preview) : null;
  const header =
    state.step === "loading"
      ? { title: "Link Telegram" }
      : pending
        ? {
            title: `Link Telegram${handle ? ` ${handle}` : ""}?`,
            description:
              "Aomi bots will use this account and its agent wallet.",
          }
        : state.step === "linked"
          ? {
              title: "Linked",
              description: `${bot ?? "Your Telegram bots"} now ${bot ? "uses" : "use"} this account.`,
            }
          : state.step === "cancelled"
            ? { title: "Not linked", description: "You can close this tab." }
            : {
                title: state.failure.message,
                description: state.failure.detail,
              };

  return (
    <AomiSheet backdrop={false}>
      <SheetHeader
        title={header.title}
        description={header.description}
        onClose={pending ? () => void cancel() : onClose}
      />
      <section
        aria-label="Link Telegram"
        data-telegram-link={state.step}
        className="flex flex-col items-center gap-4 px-5 pb-5"
      >
        {state.step === "loading" ? (
          <WaitingButton>Loading link…</WaitingButton>
        ) : pending ? (
          <>
            <TelegramMark size={36} />
            <span className="rounded-control bg-aomi-surface-2 type-meta max-w-full truncate px-2.5 py-1">
              {state.preview.account.label}
            </span>
            <ul className="type-control flex w-full flex-col gap-1.5">
              {linkLines(state.preview).map((line) => (
                <li
                  key={line.key}
                  className="[&_svg]:text-aomi-muted flex items-start gap-2 [&_svg]:mt-0.5 [&_svg]:size-4 [&_svg]:shrink-0"
                >
                  {line.icon}
                  {line.text}
                </li>
              ))}
            </ul>
            <div className="flex w-full flex-col gap-2">
              {state.step === "linking" ? (
                <WaitingButton>
                  {slow ? "Finishing trades in progress…" : "Linking…"}
                </WaitingButton>
              ) : (
                <AomiButton
                  variant="primary"
                  className="h-10 w-full"
                  disabled={cancelling}
                  onClick={() => void confirm(state.preview)}
                >
                  Link
                </AomiButton>
              )}
              <AomiButton
                className="h-10 w-full"
                disabled={state.step === "linking" || cancelling}
                onClick={() => void cancel()}
              >
                Cancel
              </AomiButton>
            </div>
            <SheetFootnote>
              Only continue if {handle ?? "this Telegram account"} is you. You
              can unlink it later in Settings › Connections.
            </SheetFootnote>
          </>
        ) : state.step === "linked" ? (
          <>
            <TelegramMark size={36} />
            <span className="rounded-control bg-aomi-surface-2 type-meta max-w-full truncate px-2.5 py-1">
              {state.preview.account.label}
            </span>
            {backToBot}
          </>
        ) : state.step === "error" ? (
          state.failure.retry ? (
            <AomiButton
              className="h-10 w-full"
              onClick={() =>
                state.failure.retry === "confirm" && state.preview
                  ? void confirm(state.preview)
                  : load()
              }
            >
              Try again
            </AomiButton>
          ) : (
            backToBot
          )
        ) : null}
      </section>
    </AomiSheet>
  );
}
