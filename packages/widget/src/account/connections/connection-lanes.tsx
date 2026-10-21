"use client";

import { useContext } from "react";
import { ArrowRight } from "lucide-react";
import {
  defaultLane,
  type AomiAccountConnection,
  type AomiLane,
} from "@aomi-labs/client";
import { useDisplayQuery } from "@aomi-labs/react";
import { ListGroup, ListRow } from "@/ui/aomi/list-group";
import { SectionHeader } from "@/ui/aomi/section-header";
import { SheetAlert } from "@/wallet/picker/sheet-parts";
import { useShellTransport } from "@/account/transport";
import { connectionsQuery } from "@/account/account-queries";
import { SettingsNavContext } from "@/account/settings-events";
import { ConnectionMark } from "./connection-mark";
import { botTitle } from "./connections-settings";
import { useAccessWrite } from "./use-access-write";
import { FixedLane, LaneSelect, Pager, usePage } from "./wallet-view";

const connectionTitle = (connection: AomiAccountConnection) =>
  connection.kind === "telegram" ? botTitle(connection) : connection.name;

const connectionLine = (connection: AomiAccountConnection) => {
  if (connection.kind !== "telegram") return connection.detail ?? undefined;
  const handle = connection.telegram?.bot;
  const title = connectionTitle(connection);
  return handle && handle !== title ? `${handle} · Telegram` : "Telegram";
};

/**
 * A wallet's "Who can use it": every connection, three a page, each with its
 * lane on an agent wallet (`agentWallet`), or the fixed "Sign in <brand>"
 * for a wallet Aomi has no key for. Lane changes save at once.
 */
export function ConnectionLanes({
  agentWallet,
  brand,
  disabled = false,
  onClose,
}: {
  /** The agent wallet whose lanes this sets; omitted, the lanes are fixed. */
  agentWallet?: { id: string; name: string };
  /** The wallet app a fixed lane signs in. */
  brand?: string;
  disabled?: boolean;
  /** Close the sheet before "Manage in Connections" moves the page. */
  onClose: () => void;
}) {
  const { client } = useShellTransport();
  const connections = useDisplayQuery(connectionsQuery(client));
  const goTo = useContext(SettingsNavContext);
  const { write, saving, error, dialog } = useAccessWrite();
  const rows = (connections.data?.connections ?? []).filter(
    (connection) => connection.kind !== "portal",
  );
  const { page, setPage, shown } = usePage(rows, 3);
  const laneOf = (connection: AomiAccountConnection): AomiLane => {
    const pending = saving[connection.key]?.find(
      (pair) => pair.id === agentWallet?.id,
    );
    if (pending) return pending.lane;
    if (connection.ask_only) return "aomi";
    return (
      connection.wallets.find((pair) => pair.id === agentWallet?.id)?.lane ??
      defaultLane(connection.kind)
    );
  };
  return (
    <section className="flex flex-col gap-2">
      <SectionHeader
        title="Who can use it"
        count={rows.length}
        action={
          rows.length > 3 ? (
            <Pager
              page={page}
              pageSize={3}
              total={rows.length}
              onPage={setPage}
            />
          ) : goTo ? (
            <button
              type="button"
              onClick={() => {
                onClose();
                goTo("connections");
              }}
              className="type-meta text-aomi-accent-strong hover:text-aomi-fg inline-flex items-center gap-1 rounded-[6px] px-1 py-0.5 font-medium outline-none focus-visible:ring-2"
            >
              Manage in Connections
              <ArrowRight className="size-3.5" />
            </button>
          ) : undefined
        }
      />
      {error ? <SheetAlert>{error}</SheetAlert> : null}
      {shown.length ? (
        <ListGroup>
          {shown.map((connection) => {
            const title = connectionTitle(connection);
            return (
              <ListRow
                key={connection.key}
                data-pair={connection.key}
                leading={
                  <ConnectionMark
                    kind={connection.kind}
                    name={connection.name}
                  />
                }
                title={title}
                description={connectionLine(connection)}
                trailing={
                  agentWallet ? (
                    <LaneSelect
                      wallet={agentWallet.name}
                      client={title}
                      lane={laneOf(connection)}
                      askOnly={connection.ask_only}
                      disabled={disabled || Boolean(saving[connection.key])}
                      onChange={(lane) =>
                        void write(connection, agentWallet, lane, title)
                      }
                    />
                  ) : (
                    <FixedLane brand={brand ?? "the wallet"} />
                  )
                }
              />
            );
          })}
        </ListGroup>
      ) : (
        <p className="type-meta text-aomi-muted">
          Only you, here in Aomi. Apps, bots and your terminal show up here once
          they connect.
        </p>
      )}
      {dialog}
    </section>
  );
}
