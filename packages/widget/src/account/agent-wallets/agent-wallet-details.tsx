"use client";

import { useState } from "react";
import { ShieldCheck } from "lucide-react";
import type { AomiAgentWallet } from "@aomi-labs/client";
import { useDisplayQuery } from "@aomi-labs/react";
import { AomiSheet } from "@/ui/aomi/aomi-sheet";
import { AomiButton } from "@/ui/aomi/button";
import { useConfirmDialog } from "@/ui/aomi/confirm-dialog";
import { ListGroup, ListRow } from "@/ui/aomi/list-group";
import { SectionHeader } from "@/ui/aomi/section-header";
import { Segmented } from "@/ui/aomi/segmented";
import { StatusPill } from "@/ui/aomi/status-pill";
import { SheetAlert, SheetHeader } from "@/wallet/picker/sheet-parts";
import type { WalletFamily } from "@/wallet/types";
import { useShellTransport } from "@/account/transport";
import { connectionsQuery } from "@/account/account-queries";
import { CopyButton } from "@/account/account-management/controls";
import { ConnectionMark } from "@/account/connections/connection-mark";
import {
  INSTANT_CONFIRM,
  pairsWith,
  type PairMode,
} from "@/account/connections/connection-pairs";
import { AddressQr } from "./address-qr";
import {
  EVM_NETWORKS,
  familyName,
  pairedConnections,
} from "./agent-wallet-model";
import { useRefreshWallets } from "./use-refresh-wallets";

const day = (at: number) =>
  new Date(at * 1000).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });

/**
 * An agent wallet's details: a deposit QR and address per family, the
 * networks the address works on, which connections may use it (Ask or
 * Instant each), Withdraw and Archive.
 */
export function AgentWalletDetails({
  wallet,
  onClose,
  onWithdraw,
  onArchive,
}: {
  wallet: AomiAgentWallet;
  onClose: () => void;
  onWithdraw: () => void;
  onArchive: (archive: boolean) => void;
}) {
  const { client } = useShellTransport();
  const connections = useDisplayQuery(connectionsQuery(client));
  const refresh = useRefreshWallets();
  const { confirm, dialog } = useConfirmDialog();
  const [family, setFamily] = useState<WalletFamily>(
    wallet.addresses[0]?.family ?? "evm",
  );
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const address = wallet.addresses.find((entry) => entry.family === family);
  const archived = wallet.archived_at !== null;
  const pairs = pairedConnections(wallet);

  const setMode = async (key: string, label: string, mode: PairMode) => {
    const connection = connections.data?.connections.find(
      (row) => row.key === key,
    );
    if (!connection || pending) return;
    if (
      mode === "instant" &&
      !(await confirm(INSTANT_CONFIRM(label, wallet.name)))
    )
      return;
    setPending(key);
    setError(null);
    try {
      await client.account.connections.setConnectionWallets(key, {
        wallets: pairsWith(connection, wallet.id, mode),
      });
      await refresh();
    } catch {
      setError("Couldn’t save that. Try again.");
    } finally {
      setPending(null);
    }
  };

  return (
    <AomiSheet onClose={onClose}>
      <SheetHeader
        title={wallet.name}
        description={[
          "Agent wallet · hosted by Aomi",
          wallet.app
            ? `created by ${wallet.app.label} on ${day(wallet.created_at)}`
            : `created ${day(wallet.created_at)}`,
        ].join(" · ")}
        onClose={onClose}
      />
      <div className="flex min-h-0 flex-col gap-4 overflow-y-auto px-5 pb-5">
        {wallet.addresses.length > 1 ? (
          <Segmented
            label="Address family"
            className="self-center"
            value={family}
            onChange={setFamily}
            options={wallet.addresses.map((entry) => ({
              value: entry.family,
              label: familyName(entry.family),
            }))}
          />
        ) : null}
        {address ? (
          <>
            <div className="flex justify-center">
              <AddressQr address={address.address} />
            </div>
            <ListGroup>
              <ListRow
                title={`${familyName(family)} address`}
                description={address.address}
                descriptionMono
                trailing={
                  <CopyButton
                    value={address.address}
                    label={`Copy ${familyName(family)} address`}
                  />
                }
              />
            </ListGroup>
            <section className="flex flex-col gap-2">
              <SectionHeader
                title="Same address on"
                detail={
                  family === "evm" ? "every network Aomi supports" : undefined
                }
              />
              <div className="flex flex-wrap gap-1.5">
                {(family === "evm" ? EVM_NETWORKS : ["Solana"]).map((name) => (
                  <StatusPill key={name}>{name}</StatusPill>
                ))}
              </div>
              <p className="type-meta text-aomi-muted flex items-start gap-1.5">
                <ShieldCheck className="mt-px size-3.5 shrink-0" />
                Only send assets on these networks.
              </p>
            </section>
          </>
        ) : null}
        <section className="flex flex-col gap-2">
          <SectionHeader
            title="Who can use it"
            detail={`${pairs.length} ${pairs.length === 1 ? "connection" : "connections"}`}
          />
          {error ? <SheetAlert>{error}</SheetAlert> : null}
          {pairs.length ? (
            <ListGroup>
              {pairs.map((pair) => {
                const connection = connections.data?.connections.find(
                  (row) => row.key === pair.key,
                );
                const locked = Boolean(connection?.ceiling);
                return (
                  <ListRow
                    key={pair.key}
                    data-pair={pair.key}
                    leading={
                      <ConnectionMark
                        kind={connection?.kind ?? "app"}
                        name={pair.label}
                      />
                    }
                    title={pair.label}
                    description={
                      locked ? "Asks before every trade" : connection?.detail
                    }
                    trailing={
                      <Segmented
                        label={`${pair.label} mode`}
                        size="sm"
                        value={pair.instant && !locked ? "instant" : "ask"}
                        disabled={!connection || pending !== null || archived}
                        onChange={(mode) =>
                          void setMode(pair.key, pair.label, mode)
                        }
                        options={[
                          { value: "ask", label: "Ask" },
                          {
                            value: "instant",
                            label: "Instant",
                            disabled: locked,
                          },
                        ]}
                      />
                    }
                  />
                );
              })}
            </ListGroup>
          ) : (
            <p className="type-meta text-aomi-muted">
              Only you, here in Aomi. Allow a connection in Settings →
              Connections, or when a client asks.
            </p>
          )}
        </section>
        <div className="flex gap-2">
          <AomiButton className="h-10 flex-1" onClick={onWithdraw}>
            Withdraw…
          </AomiButton>
          <AomiButton
            className="h-10 flex-1"
            onClick={() => onArchive(!archived)}
          >
            {archived ? "Restore" : "Archive"}
          </AomiButton>
        </div>
      </div>
      {dialog}
    </AomiSheet>
  );
}
