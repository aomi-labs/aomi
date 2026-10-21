"use client";

import { useState } from "react";
import { Lock, Pencil, ShieldCheck, Unlink } from "lucide-react";
import type { AomiAccountConnection, AomiAgentWallet } from "@aomi-labs/client";
import { useDisplayQuery } from "@aomi-labs/react";
import { AomiSheet } from "@/ui/aomi/aomi-sheet";
import { ListGroup } from "@/ui/aomi/list-group";
import { LoadingPane } from "@/ui/aomi/loading-pane";
import { SectionHeader } from "@/ui/aomi/section-header";
import { ActionRow } from "@/ui/aomi/action-row";
import { SheetAlert, SheetHeader } from "@/wallet/picker/sheet-parts";
import { useShellTransport } from "@/account/transport";
import { agentWalletsQuery } from "@/account/account-queries";
import { useRefreshWallets } from "@/account/agent-wallets/use-refresh-wallets";
import type { PairMode } from "./connection-pairs";
import { useAccessWrite } from "./use-access-write";
import { CanApproveTrades } from "./can-approve-trades";
import { ConnectionMark } from "./connection-mark";
import { WalletAccessList } from "./wallet-access-list";

/** Where a connection approves its own Ask trades, by kind. */
/**
 * Connections › ⋯ › Manage: which agent wallets one connection may use, Ask
 * or Instant each, whether it may approve its own Ask trades, then Rename
 * and Disconnect as rows. Every change saves at once.
 */
export function ConnectionManage({
  connection,
  title = connection.name,
  description,
  onClose,
  onRename,
  onRemove,
}: {
  connection: AomiAccountConnection;
  /** The sheet's title; a Telegram bot shows its app's name. */
  title?: string;
  description: string;
  onClose: () => void;
  onRename?: () => void;
  onRemove?: () => void;
}) {
  const { client } = useShellTransport();
  const wallets = useDisplayQuery(agentWalletsQuery(client));
  const { write, saving, error, dialog } = useAccessWrite();
  const portal = connection.kind === "portal";
  const askOnly = connection.ask_only;
  const live =
    wallets.data?.wallets.filter((wallet) => wallet.archived_at === null) ?? [];
  const save = (wallet: AomiAgentWallet, mode: PairMode | null) =>
    void write(connection, wallet, mode, title);

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
        <section className="flex flex-col gap-2">
          <SectionHeader title="Wallets it can use" />
          {error ? <SheetAlert>{error}</SheetAlert> : null}
          {wallets.isPending ? (
            <LoadingPane label="Loading agent wallets" />
          ) : live.length ? (
            <WalletAccessList
              wallets={live}
              access={saving[connection.key] ?? connection.wallets}
              askOnly={askOnly}
              fixed={portal}
              onTick={(wallet, ticked) => save(wallet, ticked ? "ask" : null)}
              onMode={save}
            />
          ) : (
            <p className="type-meta text-aomi-muted">
              You have no agent wallets yet. Add one in Settings → Account.
            </p>
          )}
          {askOnly ? (
            <p className="type-meta text-aomi-muted flex items-start gap-1.5">
              <Lock className="mt-px size-3.5 shrink-0" />
              This connection asks before every trade. That was set when it
              connected.
            </p>
          ) : null}
          <p className="type-meta text-aomi-muted flex items-start gap-1.5">
            <ShieldCheck className="mt-px size-3.5 shrink-0" />
            {portal
              ? "Aomi can always use your agent wallets here; Instant signs without asking."
              : "Sign-in wallets always ask in the wallet, so they aren’t listed."}
          </p>
        </section>
        {connection.kind === "portal" ? null : (
          <Approvals connection={connection} kind={connection.kind} />
        )}
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

/** "Can approve trades": off, Ask trades are approved on Aomi only. */
function Approvals({
  connection,
  kind,
}: {
  connection: AomiAccountConnection;
  kind: Exclude<AomiAccountConnection["kind"], "portal">;
}) {
  const { client } = useShellTransport();
  const refresh = useRefreshWallets();
  const [approves, setApproves] = useState(connection.approves);
  const [error, setError] = useState(false);
  const change = async (next: boolean) => {
    setApproves(next);
    setError(false);
    try {
      await client.account.connections.setConnectionSettings(connection.key, {
        approves: next,
      });
      await refresh();
    } catch {
      setApproves(!next);
      setError(true);
    }
  };
  return (
    <section className="flex flex-col gap-2">
      <SectionHeader title="Approvals" />
      {error ? <SheetAlert>Couldn’t change that. Try again.</SheetAlert> : null}
      <CanApproveTrades
        name={connection.name}
        checked={approves}
        kind={kind}
        onCheckedChange={(next) => void change(next)}
      />
    </section>
  );
}
