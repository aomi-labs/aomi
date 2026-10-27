"use client";

import { Lock, Pencil, Unlink } from "lucide-react";
import type { AomiAccountConnection } from "@aomi-labs/client";
import { AomiSheet } from "@/ui/aomi/aomi-sheet";
import { ListGroup } from "@/ui/aomi/list-group";
import { LoadingPane } from "@/ui/aomi/loading-pane";
import { ActionRow } from "@/ui/aomi/action-row";
import { SheetAlert, SheetHeader } from "@/wallet/picker/sheet-parts";
import { useShellTransport } from "@/account/transport";
import { useAccessWrite } from "./use-access-write";
import { ConnectionMark } from "./connection-mark";
import { WalletView } from "./wallet-view";
import { lanesOf, useWalletRows } from "./use-wallet-rows";
import { connectionTitle } from "./connections-settings";

/**
 * Connections › ⋯ › Manage: every wallet as this connection sees it, with
 * its lane on each agent wallet, then Rename and Disconnect as rows. Every
 * change saves at once.
 */
export function ConnectionManage({
  connection,
  description,
  onClose,
  onRename,
  onRemove,
}: {
  connection: AomiAccountConnection;
  description: string;
  onClose: () => void;
  onRename?: () => void;
  onRemove?: () => void;
}) {
  const { client } = useShellTransport();
  const { rows, agents, isPending } = useWalletRows(client);
  const { write, saving, error, dialog } = useAccessWrite();
  const portal = connection.kind === "portal";
  const title = connectionTitle(connection);
  // A save in flight shows what it will hold.
  const pending = saving[connection.key];
  const lanes = {
    ...(agents ? lanesOf(agents, connection.key, "portal") : {}),
    ...Object.fromEntries(pending?.map((item) => [item.id, item.lane]) ?? []),
  };

  return (
    <AomiSheet onClose={onClose}>
      <SheetHeader
        leading={
          <ConnectionMark kind={connection.kind} name={connection.name} />
        }
        title={title}
        description={description}
        onClose={onClose}
      />
      <div className="flex min-h-0 flex-col gap-4 overflow-y-auto px-5 pb-5">
        <div className="flex flex-col gap-2">
          {error ? <SheetAlert>{error}</SheetAlert> : null}
          {isPending || !rows ? (
            <LoadingPane label="Loading wallets" />
          ) : (
            <WalletView
              rows={rows}
              client={portal ? "Aomi" : title}
              portal={portal}
              lanes={lanes}
              askOnly={connection.ask_only}
              disabled={Boolean(pending)}
              title="Wallets it can use"
              onLane={(row, lane) => void write(connection, row, lane, title)}
            />
          )}
          {connection.ask_only ? (
            <p className="type-meta text-aomi-muted flex items-start gap-1.5">
              <Lock className="mt-px size-3.5 shrink-0" />
              This connection asks before every trade. That was set when it
              connected.
            </p>
          ) : null}
        </div>
        {onRename ? (
          <ListGroup>
            <ActionRow icon={Pencil} label="Rename" step onClick={onRename} />
          </ListGroup>
        ) : null}
        {onRemove ? (
          <ListGroup>
            <ActionRow
              icon={Unlink}
              label="Disconnect"
              danger
              onClick={onRemove}
            />
          </ListGroup>
        ) : null}
      </div>
      {dialog}
    </AomiSheet>
  );
}
