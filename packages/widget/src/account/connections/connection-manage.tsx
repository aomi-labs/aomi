"use client";

import { useState } from "react";
import { Lock, Pencil, ShieldCheck, Unlink } from "lucide-react";
import type { AomiAccountConnection, AomiAgentWallet } from "@aomi-labs/client";
import { useDisplayQuery } from "@aomi-labs/react";
import { AomiSheet } from "@/ui/aomi/aomi-sheet";
import { useConfirmDialog } from "@/ui/aomi/confirm-dialog";
import { ListGroup } from "@/ui/aomi/list-group";
import { LoadingPane } from "@/ui/aomi/loading-pane";
import { SectionHeader } from "@/ui/aomi/section-header";
import { ActionRow } from "@/ui/aomi/action-row";
import { SheetAlert, SheetHeader } from "@/wallet/picker/sheet-parts";
import { useShellTransport } from "@/account/transport";
import { agentWalletsQuery } from "@/account/account-queries";
import { useRefreshWallets } from "@/account/agent-wallets/use-refresh-wallets";
import { INSTANT_CONFIRM, pairsWith, type PairMode } from "./connection-pairs";
import { ConnectionMark } from "./connection-mark";
import { WalletAccessList, type WalletAccess } from "./wallet-access-list";

/**
 * Connections › ⋯ › Manage: which agent wallets one connection may use, Ask
 * or Instant each, then Rename and Disconnect as rows. Every change saves at
 * once.
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
  const refresh = useRefreshWallets();
  const { confirm, dialog } = useConfirmDialog();
  const [pending, setPending] = useState(false);
  const [shown, setShown] = useState<WalletAccess[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const portal = connection.kind === "portal";
  const ceiling = connection.ceiling === "ask";
  const live =
    wallets.data?.wallets.filter((wallet) => wallet.archived_at === null) ?? [];

  const save = async (wallet: AomiAgentWallet, mode: PairMode | null) => {
    if (pending) return;
    if (
      mode === "instant" &&
      !(await confirm(INSTANT_CONFIRM(title, wallet.name)))
    )
      return;
    const wallets = pairsWith(connection, wallet.id, mode);
    // The tick and switch move at once; the server catches up behind them.
    setShown(wallets.map(({ id, instant }) => ({ id, instant })));
    setPending(true);
    setError(null);
    try {
      await client.account.connections.setConnectionWallets(connection.key, {
        wallets,
      });
      await refresh();
    } catch {
      setError("Couldn’t save that. Try again.");
    } finally {
      setShown(null);
      setPending(false);
    }
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
        <section className="flex flex-col gap-2">
          <SectionHeader
            title="Wallets it can use"
            detail={
              connection.application
                ? `locked to ${connection.application.label}`
                : undefined
            }
          />
          {error ? <SheetAlert>{error}</SheetAlert> : null}
          {wallets.isPending ? (
            <LoadingPane label="Loading agent wallets" />
          ) : live.length ? (
            <WalletAccessList
              wallets={live}
              access={shown ?? connection.wallets}
              ceiling={ceiling}
              fixed={portal}
              onTick={(wallet, ticked) =>
                void save(wallet, ticked ? "ask" : null)
              }
              onMode={(wallet, mode) => void save(wallet, mode)}
            />
          ) : (
            <p className="type-meta text-aomi-muted">
              You have no agent wallets yet. Add one in Settings → Account.
            </p>
          )}
          {ceiling ? (
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
