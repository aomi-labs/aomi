"use client";

import { useContext, useState } from "react";
import {
  Archive,
  ArchiveRestore,
  ArrowRight,
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  Copy,
  Pause,
  Pencil,
  QrCode,
  ShieldCheck,
} from "lucide-react";
import { shortAddress, type AomiAgentWallet } from "@aomi-labs/client";
import { cn, useDisplayQuery } from "@aomi-labs/react";
import { AomiSheet } from "@/ui/aomi/aomi-sheet";
import { aomiButton } from "@/ui/aomi/button";
import { ListGroup, ListRow } from "@/ui/aomi/list-group";
import { useRenameDialog } from "@/ui/aomi/rename-dialog";
import { SectionHeader } from "@/ui/aomi/section-header";
import { Segmented } from "@/ui/aomi/segmented";
import { StatusPill } from "@/ui/aomi/status-pill";
import { Switch } from "@/ui/aomi/switch";
import { ActionRow } from "@/ui/aomi/action-row";
import { SheetAlert, SheetHeader } from "@/wallet/picker/sheet-parts";
import type { WalletFamily } from "@/wallet/types";
import { useShellTransport } from "@/account/transport";
import { connectionsQuery } from "@/account/account-queries";
import { SettingsNavContext } from "@/account/settings-events";
import { BrandMark, CopyButton } from "@/account/account-management/controls";
import {
  AGENT_WALLET,
  familyTag,
  plural,
} from "@/account/account-management/wallet-model";
import { ConnectionMark } from "@/account/connections/connection-mark";
import {
  botTitle,
  usedLabel,
} from "@/account/connections/connections-settings";
import { useAccessWrite } from "@/account/connections/use-access-write";
import { AddressQr } from "./address-qr";
import {
  EVM_NETWORKS,
  familyName,
  pairedConnections,
} from "./agent-wallet-model";

/**
 * Account › agent wallet › Manage: its addresses behind one Receive row,
 * which connections may use it (Ask or Instant each), then Withdraw, Rename
 * and Pause as rows, and Archive alone at the bottom. Changes save at once.
 */
export function AgentWalletManage({
  wallet,
  pausedAll,
  pending,
  onClose,
  onWithdraw,
  onRename,
  onPause,
  onArchive,
}: {
  wallet: AomiAgentWallet;
  pausedAll: boolean;
  /** A wallet write is in flight. */
  pending: boolean;
  onClose: () => void;
  onWithdraw: () => void;
  onRename: (name: string) => Promise<boolean>;
  onPause: (paused: boolean) => void;
  onArchive: (archive: boolean) => void;
}) {
  const { client } = useShellTransport();
  const connections = useDisplayQuery(connectionsQuery(client));
  const goTo = useContext(SettingsNavContext);
  const { write, saving, error, dialog: confirmDialog } = useAccessWrite();
  const { rename, dialog: renameDialog } = useRenameDialog();
  const [receive, setReceive] = useState<WalletFamily | null>(null);
  const archived = wallet.archived_at !== null;
  const paused = wallet.paused || pausedAll;
  const pairs = pairedConnections(wallet);
  const addresses = wallet.addresses;

  if (receive)
    return (
      <AomiSheet onClose={onClose}>
        <ReceiveStep
          wallet={wallet}
          family={receive}
          onFamily={setReceive}
          onBack={() => setReceive(null)}
          onClose={onClose}
        />
      </AomiSheet>
    );

  return (
    <AomiSheet onClose={onClose}>
      <SheetHeader
        leading={
          <BrandMark
            brand={AGENT_WALLET}
            dot={wallet.paused || pausedAll ? "off" : "on"}
            dim={wallet.paused || pausedAll}
          />
        }
        title={wallet.name}
        description={[
          "Agent wallet",
          wallet.app ? `made in ${wallet.app.label}` : null,
          archived
            ? "archived"
            : wallet.last_used_at === null
              ? "not used yet"
              : usedLabel(wallet.last_used_at),
        ]
          .filter(Boolean)
          .join(" · ")}
        onClose={onClose}
      />
      <div className="flex min-h-0 flex-col gap-4 overflow-y-auto px-5 pb-5">
        {addresses.length ? (
          <ListGroup>
            <div className="hover:bg-aomi-hover has-[[data-row-main]:focus-visible]:ring-aomi-accent-strong/40 relative flex min-h-14 items-center gap-3 px-3.5 transition-colors has-[[data-row-main]:focus-visible]:ring-2 has-[[data-row-main]:focus-visible]:ring-inset">
              {/* The whole row opens Receive; only Copy sits above it. */}
              <button
                type="button"
                data-row-main
                onClick={() => setReceive(addresses[0].family)}
                className="flex min-w-0 flex-1 items-center gap-3 self-stretch py-3 text-left outline-none after:absolute after:inset-0 after:content-['']"
              >
                <span className="text-aomi-muted flex size-8 shrink-0 items-center justify-center">
                  <QrCode className="size-[18px]" />
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="type-row">Receive</span>
                  <span className="type-address text-aomi-muted truncate">
                    {addresses
                      .map((entry) => shortAddress(entry.address))
                      .join(" · ")}
                    {addresses.length === 1
                      ? ` · ${familyTag(addresses[0].family)}`
                      : null}
                  </span>
                </span>
              </button>
              {/* One address copies at once; with two, Receive lets you pick which. */}
              {addresses.length === 1 ? (
                <CopyButton
                  value={addresses[0].address}
                  label="Copy address"
                  className="relative z-10"
                />
              ) : (
                <button
                  type="button"
                  aria-label="Copy an address"
                  onClick={() => setReceive(addresses[0].family)}
                  className={cn(
                    aomiButton({ variant: "ghost", size: "icon-sm" }),
                    "relative z-10",
                  )}
                >
                  <Copy size={14} />
                </button>
              )}
              <ChevronRight
                aria-hidden
                className="text-aomi-muted pointer-events-none size-4 shrink-0"
              />
            </div>
          </ListGroup>
        ) : null}

        <section className="flex flex-col gap-2">
          <SectionHeader
            title="Who can use it"
            detail={plural(pairs.length, "connection")}
            action={
              goTo ? (
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
          {pairs.length ? (
            <ListGroup>
              {pairs.map((pair) => {
                const connection = connections.data?.connections.find(
                  (row) => row.key === pair.key,
                );
                const locked = Boolean(connection?.ask_only);
                const title =
                  connection?.kind === "telegram"
                    ? botTitle(connection)
                    : pair.label;
                const handle = connection?.telegram?.bot;
                // A save in flight shows what it will hold.
                const access =
                  saving[pair.key]?.find((entry) => entry.id === wallet.id) ??
                  pair;
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
                    title={title}
                    description={
                      locked
                        ? "Asks before every trade"
                        : connection?.kind === "telegram"
                          ? handle && handle !== title
                            ? `${handle} · Telegram`
                            : "Telegram"
                          : connection?.detail
                    }
                    trailing={
                      <Segmented
                        label={`${pair.label} mode`}
                        size="sm"
                        value={access.instant && !locked ? "instant" : "ask"}
                        disabled={!connection || archived || paused}
                        onChange={(mode) =>
                          connection &&
                          void write(connection, wallet, mode, title)
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
              Only you, here in Aomi. Allow a connection in Connections, or when
              a client asks.
            </p>
          )}
          {paused && pairs.length ? (
            <p className="type-meta text-aomi-muted flex items-start gap-1.5">
              <Pause className="mt-px size-3.5 shrink-0" />
              Paused: nothing signs, whatever these say, until you resume.
            </p>
          ) : null}
        </section>

        <ListGroup>
          <ActionRow
            icon={ArrowUpRight}
            label="Withdraw"
            step
            onClick={onWithdraw}
          />
          {archived ? null : (
            <ActionRow
              icon={Pencil}
              label="Rename"
              step
              onClick={() =>
                rename({
                  title: "Rename agent wallet",
                  description:
                    "Only you see this name. Apps and chats show it when they ask to use the wallet.",
                  value: wallet.name,
                  onSave: onRename,
                })
              }
            />
          )}
          {archived ? null : (
            <ListRow
              leading={
                <span className="flex size-8 shrink-0 items-center justify-center">
                  <Pause className="text-aomi-muted size-4" />
                </span>
              }
              title={<span className="text-[13.5px]">Pause</span>}
              description="Nothing signs until you resume"
              trailing={
                <Switch
                  aria-label={`Pause ${wallet.name}`}
                  checked={wallet.paused}
                  disabled={pending}
                  onCheckedChange={onPause}
                />
              }
            />
          )}
        </ListGroup>

        <ListGroup>
          {archived ? (
            <ActionRow
              icon={ArchiveRestore}
              label="Restore"
              onClick={() => onArchive(false)}
            />
          ) : (
            <ActionRow
              icon={Archive}
              label="Archive"
              danger
              onClick={() => onArchive(true)}
            />
          )}
        </ListGroup>
      </div>
      {confirmDialog}
      {renameDialog}
    </AomiSheet>
  );
}

/** Receive: a tab per family (only with two), the QR, the address, its networks. */
function ReceiveStep({
  wallet,
  family,
  onFamily,
  onBack,
  onClose,
}: {
  wallet: AomiAgentWallet;
  family: WalletFamily;
  onFamily: (family: WalletFamily) => void;
  onBack: () => void;
  onClose: () => void;
}) {
  const address = wallet.addresses.find((entry) => entry.family === family);
  return (
    <>
      <SheetHeader
        leading={
          <button
            type="button"
            aria-label="Back"
            onClick={onBack}
            className={aomiButton({ variant: "ghost", size: "icon-sm" })}
          >
            <ChevronLeft className="size-4" />
          </button>
        }
        title="Receive"
        description={`${wallet.name} · send only on the networks listed`}
        onClose={onClose}
      />
      <div className="flex min-h-0 flex-col gap-4 overflow-y-auto px-5 pb-5">
        {wallet.addresses.length > 1 ? (
          <Segmented
            label="Address family"
            className="self-center"
            value={family}
            onChange={onFamily}
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
      </div>
    </>
  );
}
