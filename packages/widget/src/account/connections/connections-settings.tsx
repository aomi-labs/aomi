"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { useDisplayQuery } from "@aomi-labs/react";
import type {
  AomiAccountConnection,
  AomiConnectionKind,
} from "@aomi-labs/client";
import { aomiButton } from "@/ui/aomi/button";
import { useConfirmDialog } from "@/ui/aomi/confirm-dialog";
import { ListGroup, ListRow } from "@/ui/aomi/list-group";
import { LoadingPane } from "@/ui/aomi/loading-pane";
import { SectionHeader } from "@/ui/aomi/section-header";
import { StatusPill } from "@/ui/aomi/status-pill";
import { useShellTransport } from "@/account/transport";
import {
  ActionsMenu,
  type MenuItem,
} from "@/account/account-management/controls";
import { connectionsQuery } from "@/account/account-queries";
import { ConnectAppSheet } from "./connect-app-sheet";
import { ConnectionMark } from "./connection-mark";

const KIND_LABEL: Record<AomiConnectionKind, string> = {
  portal: "This website",
  ai: "AI client",
  app: "App",
  cli: "Terminal",
  telegram: "Telegram",
};

/** `used 2 h ago`, `used yesterday`, `used Oct 15`. */
export function usedLabel(at: number, now = Date.now()): string {
  const seconds = Math.max(0, now / 1000 - at);
  if (seconds < 60) return "used just now";
  if (seconds < 3_600) return `used ${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86_400) return `used ${Math.floor(seconds / 3_600)} h ago`;
  if (seconds < 172_800) return "used yesterday";
  return `used ${new Date(at * 1000).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  })}`;
}

function description(row: AomiAccountConnection): string {
  const used = row.last_used_at === null ? null : usedLabel(row.last_used_at);
  return [row.detail ?? KIND_LABEL[row.kind], used].filter(Boolean).join(" · ");
}

/** Settings › Connections: who uses the account, and whether they ask. */
export function ConnectionsSettings() {
  const { client } = useShellTransport();
  const query = useDisplayQuery(connectionsQuery(client));
  const { confirm, dialog } = useConfirmDialog();
  const [adding, setAdding] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);

  if (query.isPending) return <LoadingPane label="Loading connections" />;
  const rows = query.data?.connections ?? [];

  const run = async (key: string, action: () => Promise<unknown>) => {
    if (pending) return;
    setPending(key);
    setError(null);
    try {
      await action();
      await query.refetch();
    } catch (cause) {
      setError(
        (cause as { code?: string }).code === "cannot_unlink_last_login_factor"
          ? "Telegram is your only way to sign in. Add another sign-in first."
          : "Couldn’t save that. Try again.",
      );
    } finally {
      setPending(null);
    }
  };
  const settings = client.account.connections;
  const setInstant = async (row: AomiAccountConnection, instant: boolean) => {
    if (
      instant &&
      !(await confirm({
        title: "Sign without asking?",
        description: `Trades from ${row.name} will sign without asking.`,
        confirmLabel: "Turn on",
      }))
    )
      return;
    await run(row.key, () =>
      settings.setConnectionSettings(row.key, { instant }),
    );
  };
  const rename = (row: AomiAccountConnection) =>
    run(row.key, async () => {
      await settings.setConnectionSettings(row.key, {
        label: draft.trim() || null,
      });
      setRenaming(null);
    });
  const remove = async (row: AomiAccountConnection) => {
    const telegram = row.kind === "telegram";
    if (
      !(await confirm({
        title: telegram ? "Unlink Telegram?" : `Remove ${row.name}?`,
        description: telegram
          ? "The bots stop using this account. Your chats stay here; the next message on Telegram starts fresh."
          : "It has to connect again.",
        confirmLabel: telegram ? "Unlink" : "Remove",
        tone: "danger",
      }))
    )
      return;
    await run(row.key, () =>
      telegram
        ? settings.disconnectTelegram()
        : settings.disconnectOAuth(row.key.slice("oauth:".length)),
    );
  };

  const menu = (row: AomiAccountConnection): MenuItem[] => {
    const items: MenuItem[] = [
      {
        label: "Ask before each trade",
        detail: row.instant ? undefined : "Selected",
        checked: !row.instant,
        onSelect: () => row.instant && setInstant(row, false),
      },
      {
        label: "Trade without asking",
        detail: row.instant ? "Selected" : "Signs right away, after a confirm",
        checked: row.instant,
        onSelect: () => !row.instant && setInstant(row, true),
      },
    ];
    if (row.kind === "portal") return items;
    items.push("divider", {
      label: "Rename",
      onSelect: () => {
        setDraft(row.name);
        setRenaming(row.key);
      },
    });
    if (row.removable)
      items.push("divider", {
        label: row.kind === "telegram" ? "Unlink Telegram" : "Remove",
        detail:
          row.kind === "telegram"
            ? "The bots stop using this account"
            : `${row.name} has to connect again`,
        danger: true,
        onSelect: () => remove(row),
      });
    return items;
  };

  return (
    <section className="flex flex-col gap-2">
      <SectionHeader
        title="Connected"
        detail="Each one asks before trades unless you change it"
        action={
          <button
            type="button"
            onClick={() => setAdding(true)}
            className={aomiButton({ variant: "secondary", size: "sm" })}
          >
            <Plus />
            Add
          </button>
        }
      />
      {error || query.error ? (
        <p role="alert" className="type-meta text-aomi-danger px-0.5">
          {error ?? "Couldn’t load your connections."}
        </p>
      ) : null}
      <ListGroup>
        {rows.map((row) => (
          <ListRow
            key={row.key}
            data-connection={row.key}
            leading={<ConnectionMark kind={row.kind} name={row.name} />}
            title={
              renaming === row.key ? (
                <input
                  autoFocus
                  value={draft}
                  maxLength={40}
                  aria-label={`Name for ${row.name}`}
                  disabled={pending === row.key}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void rename(row);
                    if (event.key === "Escape") setRenaming(null);
                  }}
                  className="border-aomi-border bg-aomi-bg text-aomi-fg focus:border-aomi-muted type-row rounded-control h-7 w-full max-w-56 border px-2 outline-none transition-colors"
                />
              ) : (
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className="truncate">{row.name}</span>
                  {row.instant ? (
                    <StatusPill tone="warning">Instant</StatusPill>
                  ) : null}
                </span>
              )
            }
            description={description(row)}
            trailing={
              <ActionsMenu
                label={`Actions for ${row.name}`}
                items={menu(row)}
                disabled={pending !== null}
                busy={pending === row.key}
              />
            }
          />
        ))}
      </ListGroup>
      {rows.every((row) => row.kind === "portal") ? (
        <p className="type-meta text-aomi-muted px-0.5">
          Use Aomi from Claude, your terminal or Telegram.
        </p>
      ) : null}
      {adding ? <ConnectAppSheet onClose={() => setAdding(false)} /> : null}
      {dialog}
    </section>
  );
}
