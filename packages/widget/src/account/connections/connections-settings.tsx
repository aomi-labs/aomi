"use client";

import { lazy, Suspense, useState, type ReactNode } from "react";
import {
  Bot,
  ChevronRight,
  Pencil,
  Plus,
  SlidersHorizontal,
  Unlink,
} from "lucide-react";
import { cn, useDisplayQuery } from "@aomi-labs/react";
import type {
  AomiAccountConnection,
  AomiConnectionKind,
} from "@aomi-labs/client";
import { AomiSheet } from "@/ui/aomi/aomi-sheet";
import { aomiButton } from "@/ui/aomi/button";
import { useConfirmDialog } from "@/ui/aomi/confirm-dialog";
import { ListGroup, listGroupClass } from "@/ui/aomi/list-group";
import { LoadingPane } from "@/ui/aomi/loading-pane";
import { useRenameDialog } from "@/ui/aomi/rename-dialog";
import { SectionHeader } from "@/ui/aomi/section-header";
import { ActionRow } from "@/ui/aomi/action-row";
import { SheetHeader } from "@/wallet/picker/sheet-parts";
import { useShellTransport } from "@/account/transport";
import {
  ActionsMenu,
  Divider,
  ExpandToggle,
  rowStart,
  type MenuItem,
} from "@/account/account-management/controls";
import { connectionsQuery } from "@/account/account-queries";
import { CHILD_INDENT } from "@/account/account-management/wallet-rows";
import { StateMeta, withApp } from "@/account/account-management/labels";
import { ConnectAppSheet } from "./connect-app-sheet";
import { ConnectionMark } from "./connection-mark";

// Opened from a row's menu, so it loads only then.
const ConnectionManage = lazy(() =>
  import("./connection-manage").then((module) => ({
    default: module.ConnectionManage,
  })),
);

/** The Connections card's bands, in order. */
const BANDS: {
  title: string;
  detail: string;
  kinds: readonly AomiConnectionKind[];
}[] = [
  { title: "Websites", detail: "Aomi in your browser", kinds: ["portal"] },
  {
    title: "Chat bots",
    detail: "Bots you trade with in chat",
    kinds: ["telegram"],
  },
  {
    title: "AI assistants",
    detail: "Claude, Cursor, pi and other MCP clients",
    kinds: ["ai"],
  },
  {
    title: "Terminal and apps",
    detail: "The CLI, the SDK and apps you signed in to",
    kinds: ["cli", "app"],
  },
];

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

const plural = (count: number, word: string) =>
  `${count} ${count === 1 ? word : `${word}s`}`;

const liveWallets = (row: AomiAccountConnection) =>
  row.wallets.filter((wallet) => !wallet.archived);

/**
 * A Telegram bot's title: your own name for it, else the app it is locked
 * to, else its @handle.
 */
export function botTitle(row: AomiAccountConnection): string {
  const handle = row.telegram?.bot;
  if (handle && row.name !== handle) return row.name;
  return row.application?.label ?? row.name;
}

/**
 * `AI client · [app] Hoodit · 1 wallet · used 2 h ago`. A Telegram bot is
 * titled by its app already, so its line starts with its @handle instead.
 */
function description(row: AomiAccountConnection): ReactNode {
  const used = row.last_used_at === null ? null : usedLabel(row.last_used_at);
  if (row.kind === "portal")
    return [KIND_LABEL.portal, "all agent wallets"].join(" · ");
  const telegram = row.kind === "telegram";
  const handle =
    telegram && row.telegram?.bot !== botTitle(row) ? row.telegram?.bot : null;
  const lead =
    handle ?? (telegram ? null : (row.detail ?? KIND_LABEL[row.kind]));
  const rest = [plural(liveWallets(row).length, "wallet"), used]
    .filter(Boolean)
    .join(" · ");
  return (
    <>
      {lead ? `${lead}` : null}
      {telegram ? null : withApp(row.application)}
      {lead ? " · " : null}
      {rest}
    </>
  );
}

const isInstant = (row: AomiAccountConnection) =>
  row.wallets.some((wallet) => wallet.instant && !wallet.archived);

/** `@hyperlabai_bot · Telegram bot · connected Oct 16`, under a Manage sheet's title. */
function sheetDescription(row: AomiAccountConnection): string {
  return [
    row.kind === "telegram" && row.telegram?.bot !== botTitle(row)
      ? row.telegram?.bot
      : null,
    row.kind === "telegram"
      ? "Telegram bot"
      : (row.detail ?? KIND_LABEL[row.kind]),
    row.connected_at === null
      ? null
      : `connected ${new Date(row.connected_at * 1000).toLocaleDateString(
          "en-US",
          { month: "short", day: "numeric" },
        )}`,
  ]
    .filter(Boolean)
    .join(" · ");
}

/**
 * Settings › Connections: who uses the account, and which wallets each may
 * use. Telegram is linked once for the account, so its bots sit under one
 * Telegram row.
 */
export function ConnectionsSettings() {
  const { client } = useShellTransport();
  const query = useDisplayQuery(connectionsQuery(client));
  const { confirm, dialog } = useConfirmDialog();
  const { rename, dialog: renameDialog } = useRenameDialog();
  const [adding, setAdding] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [managing, setManaging] = useState<string | null>(null);
  const [telegramOpen, setTelegramOpen] = useState(true);
  const [telegramSheet, setTelegramSheet] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (query.isPending) return <LoadingPane label="Loading connections" />;
  const rows = query.data?.connections ?? [];
  const bots = rows.filter((row) => row.kind === "telegram");

  const run = async (key: string, action: () => Promise<unknown>) => {
    if (pending) return false;
    setPending(key);
    setError(null);
    try {
      await action();
      await query.refetch();
      return true;
    } catch (cause) {
      setError(
        (cause as { code?: string }).code === "cannot_unlink_last_login_factor"
          ? "Telegram is your only way to sign in. Add another sign-in first."
          : "Couldn’t save that. Try again.",
      );
      return false;
    } finally {
      setPending(null);
    }
  };
  const settings = client.account.connections;
  const startRename = (row: AomiAccountConnection) => {
    setManaging(null);
    rename({
      title: "Rename connection",
      description: "Only you see this name.",
      value: row.name,
      maxLength: 40,
      onSave: (name) =>
        run(row.key, () =>
          settings.setConnectionSettings(row.key, { label: name || null }),
        ),
    });
  };
  const remove = async (row: AomiAccountConnection) => {
    setManaging(null);
    if (
      !(await confirm({
        title: `Disconnect ${row.name}?`,
        description:
          "It stops using your account and has to connect again to come back.",
        confirmLabel: "Disconnect",
        tone: "danger",
      }))
    )
      return;
    await run(row.key, () =>
      settings.disconnectOAuth(row.key.slice("oauth:".length)),
    );
  };
  const disconnectTelegram = async () => {
    setTelegramSheet(false);
    if (
      !(await confirm({
        title: "Disconnect Telegram?",
        description:
          "Every bot stops using this account. Your chats stay here; the next message on Telegram starts fresh.",
        confirmLabel: "Disconnect",
        tone: "danger",
      }))
    )
      return;
    await run("telegram", () => settings.disconnectTelegram());
  };

  const manage = (row: AomiAccountConnection): MenuItem => ({
    label: "Manage",
    icon: SlidersHorizontal,
    onSelect: () => setManaging(row.key),
  });
  const menu = (row: AomiAccountConnection): MenuItem[] => {
    const items = [manage(row)];
    if (row.kind === "portal") return items;
    items.push({
      label: "Rename",
      icon: Pencil,
      onSelect: () => startRename(row),
    });
    if (row.removable && row.kind !== "telegram")
      items.push({
        label: "Disconnect",
        icon: Unlink,
        danger: true,
        onSelect: () => void remove(row),
      });
    return items;
  };
  const managed = rows.find((row) => row.key === managing);

  const connectionRow = (row: AomiAccountConnection, nested = false) => (
    <Row
      key={row.key}
      data-connection={row.key}
      nested={nested}
      leading={
        row.kind === "telegram" ? (
          <span
            aria-hidden
            className="text-aomi-muted flex size-8 shrink-0 items-center justify-center"
          >
            <Bot className="size-[18px]" />
          </span>
        ) : (
          <ConnectionMark kind={row.kind} name={row.name} />
        )
      }
      title={
        <span className="truncate">
          {row.kind === "telegram" ? botTitle(row) : row.name}
        </span>
      }
      description={description(row)}
      trailing={
        <>
          {isInstant(row) ? <StateMeta state="instant" /> : null}
          <ActionsMenu
            label={`Actions for ${row.name}`}
            items={menu(row)}
            disabled={pending !== null}
            busy={pending === row.key}
          />
        </>
      }
    />
  );

  const telegramUser = bots.find((row) => row.telegram?.user)?.telegram?.user;
  const telegramWallets = new Set(
    bots.flatMap((row) => liveWallets(row).map((wallet) => wallet.id)),
  ).size;
  const telegramGroup = bots.length ? (
    <div key="telegram" data-connection="telegram">
      <Row
        expand={
          <ExpandToggle
            open={telegramOpen}
            label="Telegram bots"
            onToggle={() => setTelegramOpen((value) => !value)}
          />
        }
        onClick={() => setTelegramOpen((value) => !value)}
        leading={<ConnectionMark kind="telegram" name="Telegram" />}
        title={<span className="truncate">Telegram</span>}
        description={[
          telegramUser,
          plural(bots.length, "bot"),
          plural(telegramWallets, "wallet"),
        ]
          .filter(Boolean)
          .join(" · ")}
        trailing={
          <ActionsMenu
            label="Actions for Telegram"
            disabled={pending !== null}
            busy={pending === "telegram"}
            items={[
              {
                label: "Manage",
                icon: SlidersHorizontal,
                onSelect: () => setTelegramSheet(true),
              },
              ...(bots.some((row) => row.removable)
                ? [
                    {
                      label: "Disconnect Telegram",
                      icon: Unlink,
                      danger: true,
                      onSelect: () => void disconnectTelegram(),
                    },
                  ]
                : []),
            ]}
          />
        }
      />
      {telegramOpen ? bots.map((row) => connectionRow(row, true)) : null}
    </div>
  ) : null;

  // Each band lists its connections most recent first; Telegram's group is
  // the one row of Chat bots. A band with nothing in it is left out.
  const bands = BANDS.map((band) => ({
    ...band,
    items: band.kinds.includes("telegram")
      ? [telegramGroup].filter(Boolean)
      : rows
          .filter((row) => band.kinds.includes(row.kind))
          .map((row) => connectionRow(row)),
  })).filter((band) => band.items.length > 0);

  return (
    <section className="flex flex-col gap-2">
      <SectionHeader
        title="Connected"
        detail="Each one uses only the agent wallets you allow"
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
      <div className={listGroupClass}>
        {bands.map((band, index) => (
          <div
            key={band.title}
            data-connection-band={band.title}
            // The card's own border is the first band's top line.
            className={cn(index === 0 && "[&>[data-band]]:border-t-0")}
          >
            <Divider title={band.title} detail={band.detail} />
            <div className="divide-aomi-border divide-y">{band.items}</div>
          </div>
        ))}
      </div>
      {rows.every((row) => row.kind === "portal") ? (
        <p className="type-meta text-aomi-muted px-0.5">
          Use Aomi from Claude, your terminal or Telegram.
        </p>
      ) : null}
      {adding ? <ConnectAppSheet onClose={() => setAdding(false)} /> : null}
      {telegramSheet ? (
        <TelegramSheet
          user={telegramUser ?? null}
          bots={bots}
          onClose={() => setTelegramSheet(false)}
          onBot={(row) => {
            setTelegramSheet(false);
            setManaging(row.key);
          }}
          onDisconnect={
            bots.some((row) => row.removable)
              ? () => void disconnectTelegram()
              : undefined
          }
        />
      ) : null}
      <Suspense fallback={null}>
        {managed ? (
          <ConnectionManage
            connection={managed}
            title={
              managed.kind === "telegram" ? botTitle(managed) : managed.name
            }
            description={sheetDescription(managed)}
            onClose={() => setManaging(null)}
            onRename={
              managed.kind === "portal" ? undefined : () => startRename(managed)
            }
            onRemove={
              managed.removable && managed.kind !== "telegram"
                ? () => void remove(managed)
                : undefined
            }
          />
        ) : null}
      </Suspense>
      {dialog}
      {renameDialog}
    </section>
  );
}

/** One connection row; a gutter in front so marks line up with Telegram's chevron. */
function Row({
  expand,
  nested = false,
  leading,
  title,
  description,
  trailing,
  onClick,
  ...props
}: {
  expand?: ReactNode;
  nested?: boolean;
  leading: ReactNode;
  title: ReactNode;
  description: ReactNode;
  trailing: ReactNode;
  onClick?: () => void;
  "data-connection"?: string;
}) {
  const body = (
    <>
      {leading}
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="type-row flex min-w-0 items-center gap-1.5">
          {title}
        </span>
        <span className="type-meta text-aomi-muted truncate">
          {description}
        </span>
      </span>
    </>
  );
  return (
    <div
      {...props}
      className={cn(
        "flex min-h-14 items-center gap-3 pr-3",
        nested
          ? cn("border-aomi-border border-t", CHILD_INDENT)
          : rowStart(Boolean(expand)),
        onClick && "hover:bg-aomi-hover transition-colors",
      )}
    >
      {nested ? null : expand}
      {onClick ? (
        <button
          type="button"
          tabIndex={-1}
          onClick={onClick}
          className="flex min-w-0 flex-1 items-center gap-3 self-stretch py-3 text-left outline-none"
        >
          {body}
        </button>
      ) : (
        <div className="flex min-w-0 flex-1 items-center gap-3 py-3">
          {body}
        </div>
      )}
      {trailing}
    </div>
  );
}

/** Telegram › Manage: the linked account, its bots, and Disconnect. */
function TelegramSheet({
  user,
  bots,
  onClose,
  onBot,
  onDisconnect,
}: {
  user: string | null;
  bots: AomiAccountConnection[];
  onClose: () => void;
  onBot: (row: AomiAccountConnection) => void;
  onDisconnect?: () => void;
}) {
  return (
    <AomiSheet onClose={onClose}>
      <SheetHeader
        leading={<ConnectionMark kind="telegram" name="Telegram" />}
        title="Telegram"
        description={[user, "linked to this account"]
          .filter(Boolean)
          .join(" · ")}
        onClose={onClose}
      />
      <div className="flex min-h-0 flex-col gap-4 overflow-y-auto px-5 pb-5">
        <section className="flex flex-col gap-2">
          <SectionHeader
            title="Bots"
            detail="Each bot uses only the wallets you allow it"
          />
          <ListGroup>
            {bots.map((row) => (
              <button
                key={row.key}
                type="button"
                onClick={() => onBot(row)}
                className="hover:bg-aomi-hover flex min-h-14 w-full items-center gap-3 px-3.5 py-3 text-left outline-none transition-colors"
              >
                <span
                  aria-hidden
                  className="text-aomi-muted flex size-8 shrink-0 items-center justify-center"
                >
                  <Bot className="size-[18px]" />
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="type-row truncate">{botTitle(row)}</span>
                  <span className="type-meta text-aomi-muted truncate">
                    {description(row)}
                  </span>
                </span>
                {isInstant(row) ? <StateMeta state="instant" /> : null}
                <ChevronRight className="text-aomi-muted size-4 shrink-0" />
              </button>
            ))}
          </ListGroup>
        </section>
        {onDisconnect ? (
          <ListGroup>
            <ActionRow
              icon={Unlink}
              label="Disconnect Telegram"
              description="Every bot stops using this account"
              danger
              onClick={onDisconnect}
            />
          </ListGroup>
        ) : null}
      </div>
    </AomiSheet>
  );
}
