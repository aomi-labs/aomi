"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ArrowRight, Send } from "lucide-react";
import {
  TelegramLinkError,
  shortAddress,
  type AomiClient,
  type TelegramLinkPreview,
  type TelegramLinkResult,
  type TelegramLinkWalletMove,
} from "@aomi-labs/client";
import { AomiButton, aomiButton } from "@/ui/aomi/button";
import { ListGroup, ListRow } from "@/ui/aomi/list-group";
import { AomiMark } from "@/ui/aomi-mark";

export type TelegramLinkPanelProps = {
  /** A portal-session client; the link routes refuse every other credential. */
  client: AomiClient;
  /** The `/link` code from the page URL; null when it is malformed. */
  code: string | null;
  /** Where "Open Settings" goes once linked. */
  settingsHref?: string;
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
  | { step: "linked"; result: TelegramLinkResult }
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
      message: FAILURES.account_link_busy!,
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

function usd(value: string | null): string | undefined {
  const amount = value == null ? Number.NaN : Number(value);
  if (!Number.isFinite(amount)) return undefined;
  return amount.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** The server sends a short form already; shorten a full one. */
const short = (address: string) =>
  address.includes("…") ? address : shortAddress(address);

const handleOf = (preview: TelegramLinkPreview) =>
  preview.telegram.username ? `@${preview.telegram.username}` : null;

function lead(preview: TelegramLinkPreview): string {
  const handle = handleOf(preview);
  const who = handle ? `Telegram ${handle}` : "your Telegram account";
  const wallets = preview.moves.agent_wallets;
  if (!wallets.length) return `Add ${who} to this account?`;
  if (wallets.length > 1)
    return `Add ${who} and its ${wallets.length} agent wallets to this account?`;
  const balance = usd(wallets[0]!.total_usd);
  return `Add ${who} and its agent wallet${balance ? ` (${balance})` : ""} to this account?`;
}

function usedIn(preview: TelegramLinkPreview): string | undefined {
  const bots = preview.telegram.bots.length
    ? preview.telegram.bots
    : preview.telegram.linked_from
      ? [preview.telegram.linked_from]
      : [];
  return bots.length
    ? `used in ${bots.map((bot) => bot.label).join(", ")}`
    : undefined;
}

function walletRow(wallet: TelegramLinkWalletMove) {
  const becomes =
    wallet.becomes === "default"
      ? "becomes your agent wallet"
      : "becomes an extra wallet here; your Telegram bots keep using it";
  const balance = usd(wallet.total_usd);
  return {
    title: `${wallet.label} ${short(wallet.address)}`,
    description: balance ? `${balance} · ${becomes}` : becomes,
  };
}

/** The "What moves" lines, in the contract's order. */
function moveLines(preview: TelegramLinkPreview) {
  const { moves } = preview;
  const lines: { key: string; title: string; description?: string }[] =
    moves.agent_wallets.map((wallet) => ({
      key: wallet.id,
      ...walletRow(wallet),
    }));
  if (moves.chats_in_bots)
    lines.push({
      key: "chats",
      title: `Chats stay in their bots (${moves.chats_in_bots})`,
    });
  if (moves.scheduled_jobs)
    lines.push({
      key: "jobs",
      title: `Scheduled tasks (${moves.scheduled_jobs}) run from this account`,
    });
  if (moves.agent_wallets.length) {
    const instant = [
      ...new Set(moves.agent_wallets.flatMap((wallet) => wallet.instant)),
    ];
    lines.push({
      key: "rules",
      title: instant.length
        ? `Approval rules move with each wallet (Instant in ${instant.join(", ")} stays on)`
        : "Approval rules move with each wallet",
    });
  }
  if (moves.pending_trades.cancel)
    lines.push({
      key: "cancel",
      title: `${plural(moves.pending_trades.cancel, "trade")} waiting for approval will be cancelled. Nothing was signed.`,
    });
  if (moves.world.length)
    lines.push({
      key: "world",
      title: "World Markets trading stays connected",
    });
  return lines;
}

/**
 * The `/link/telegram` page: what linking a Telegram account to this one
 * moves, then Link Telegram or Cancel. Loading → preview | error; Link →
 * linking → linked | error.
 */
export function TelegramLinkPanel({
  client,
  code,
  settingsHref = "/settings/account",
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
      if (mounted.current) setState({ step: "linked", result });
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

  return (
    <section
      aria-label="Link Telegram"
      data-telegram-link={state.step}
      className="text-aomi-fg flex w-full min-w-0 flex-col gap-4"
    >
      <h1 className="text-lg font-semibold tracking-tight">
        Link Telegram to this account
      </h1>
      {state.step === "loading" ? (
        <p role="status" className="type-meta text-aomi-muted">
          Loading link…
        </p>
      ) : state.step === "preview" || state.step === "linking" ? (
        <PreviewBody
          preview={state.preview}
          linking={state.step === "linking"}
          slow={slow}
          cancelling={cancelling}
          onCancel={() => void cancel()}
          onConfirm={() => void confirm(state.preview)}
        />
      ) : state.step === "linked" ? (
        <div className="flex flex-col gap-3">
          <p role="status" className="type-row">
            Linked. Your Telegram bots now use this account.
          </p>
          {state.result.cancelled ? (
            <p className="type-meta text-aomi-muted">
              {plural(state.result.cancelled, "trade")} waiting for approval
              {state.result.cancelled === 1 ? " was" : " were"} cancelled.
              Nothing was signed.
            </p>
          ) : null}
          <a
            href={settingsHref}
            className={aomiButton({ variant: "secondary", size: "md" })}
          >
            Open Settings
          </a>
        </div>
      ) : state.step === "cancelled" ? (
        <p role="status" className="type-row">
          Not linked. You can close this page.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          <div role="alert" className="flex flex-col gap-1">
            <p className="type-row">{state.failure.message}</p>
            {state.failure.detail ? (
              <p className="type-meta text-aomi-muted">
                {state.failure.detail}
              </p>
            ) : null}
          </div>
          {state.failure.retry ? (
            <AomiButton
              variant="secondary"
              className="self-start"
              onClick={() =>
                state.failure.retry === "confirm" && state.preview
                  ? void confirm(state.preview)
                  : load()
              }
            >
              Try again
            </AomiButton>
          ) : null}
        </div>
      )}
    </section>
  );
}

function PreviewBody({
  preview,
  linking,
  slow,
  cancelling,
  onCancel,
  onConfirm,
}: {
  preview: TelegramLinkPreview;
  linking: boolean;
  slow: boolean;
  cancelling: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const handle = handleOf(preview);
  const telegramUse = usedIn(preview);
  return (
    <>
      <p className="type-control text-aomi-muted">{lead(preview)}</p>
      <div className="grid items-center gap-2 sm:grid-cols-[1fr_auto_1fr]">
        <SideCard
          icon={<Send className="text-aomi-muted size-4" />}
          title={`Telegram${handle ? ` ${handle}` : ""}`}
          detail={telegramUse}
        />
        <ArrowRight
          aria-hidden
          className="text-aomi-muted mx-auto size-4 rotate-90 sm:rotate-0"
        />
        <SideCard
          icon={<AomiMark size={15} className="text-aomi-fg" />}
          title={preview.account.label}
          detail="stays your account"
        />
      </div>
      <div className="flex flex-col gap-2">
        <h2 className="type-meta text-aomi-muted px-0.5 font-medium">
          What moves
        </h2>
        <ListGroup>
          {moveLines(preview).map((line) => (
            <ListRow
              key={line.key}
              className="min-h-0 py-2.5"
              title={line.title}
              description={line.description}
            />
          ))}
        </ListGroup>
      </div>
      <p className="type-meta text-aomi-muted">
        Only continue if {handle ?? "this"} is your Telegram account. The
        Telegram account becomes part of this one; this can’t be undone yet.
      </p>
      <div className="flex flex-wrap items-center justify-end gap-2">
        {linking && slow ? (
          <p role="status" className="type-meta text-aomi-muted mr-auto">
            Linking… finishing trades in progress
          </p>
        ) : null}
        <AomiButton
          variant="secondary"
          disabled={linking || cancelling}
          onClick={onCancel}
        >
          {cancelling ? "Cancelling…" : "Cancel"}
        </AomiButton>
        <AomiButton
          variant="primary"
          disabled={linking || cancelling}
          onClick={onConfirm}
        >
          {linking ? "Linking…" : "Link Telegram"}
        </AomiButton>
      </div>
    </>
  );
}

function SideCard({
  icon,
  title,
  detail,
}: {
  icon: ReactNode;
  title: string;
  detail?: string;
}) {
  return (
    <div className="rounded-card border-aomi-border bg-aomi-raised flex min-w-0 items-center gap-3 border px-3.5 py-3">
      <span className="bg-aomi-surface-2 flex size-8 shrink-0 items-center justify-center rounded-full">
        {icon}
      </span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="type-row truncate" title={title}>
          {title}
        </span>
        {detail ? (
          <span className="type-meta text-aomi-muted truncate">{detail}</span>
        ) : null}
      </span>
    </div>
  );
}
