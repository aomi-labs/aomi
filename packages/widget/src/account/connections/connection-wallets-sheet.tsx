"use client";

import { useState } from "react";
import { Lock, ShieldCheck } from "lucide-react";
import type { AomiAccountConnection, AomiAgentWallet } from "@aomi-labs/client";
import { useDisplayQuery } from "@aomi-labs/react";
import { AomiSheet } from "@/ui/aomi/aomi-sheet";
import { AomiButton } from "@/ui/aomi/button";
import { useConfirmDialog } from "@/ui/aomi/confirm-dialog";
import { LoadingPane } from "@/ui/aomi/loading-pane";
import { SectionHeader } from "@/ui/aomi/section-header";
import { SheetAlert, SheetHeader } from "@/wallet/picker/sheet-parts";
import { useShellTransport } from "@/account/transport";
import { agentWalletsQuery } from "@/account/account-queries";
import { useRefreshWallets } from "@/account/agent-wallets/use-refresh-wallets";
import { INSTANT_CONFIRM, pairsWith, type PairMode } from "./connection-pairs";
import { WalletAccessList } from "./wallet-access-list";

/**
 * Connections › ⋯ › Wallets…: which agent wallets one connection may use,
 * Ask or Instant each. Every change saves at once.
 */
export function ConnectionWalletsSheet({
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
  const wallets = useDisplayQuery(agentWalletsQuery(client));
  const refresh = useRefreshWallets();
  const { confirm, dialog } = useConfirmDialog();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const portal = connection.kind === "portal";
  const ceiling = connection.ceiling === "ask";
  const live =
    wallets.data?.wallets.filter((wallet) => wallet.archived_at === null) ?? [];

  const save = async (wallet: AomiAgentWallet, mode: PairMode | null) => {
    if (pending) return;
    if (
      mode === "instant" &&
      !(await confirm(INSTANT_CONFIRM(connection.name, wallet.name)))
    )
      return;
    setPending(true);
    setError(null);
    try {
      await client.account.connections.setConnectionWallets(connection.key, {
        wallets: pairsWith(connection, wallet.id, mode),
      });
      await refresh();
    } catch {
      setError("Couldn’t save that. Try again.");
    } finally {
      setPending(false);
    }
  };

  return (
    <AomiSheet onClose={onClose}>
      <SheetHeader
        title={connection.name}
        description={description}
        onClose={onClose}
      />
      <div className="flex min-h-0 flex-col gap-3 overflow-y-auto px-5 pb-5">
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
            access={connection.wallets}
            ceiling={ceiling}
            fixed={portal}
            disabled={pending}
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
        {onRename || onRemove ? (
          <div className="flex gap-2">
            {onRename ? (
              <AomiButton className="h-10 flex-1" onClick={onRename}>
                Rename
              </AomiButton>
            ) : null}
            {onRemove ? (
              <AomiButton
                variant="danger"
                className="h-10 flex-1"
                onClick={onRemove}
              >
                {connection.kind === "telegram" ? "Unlink" : "Remove"}
              </AomiButton>
            ) : null}
          </div>
        ) : null}
      </div>
      {dialog}
    </AomiSheet>
  );
}
