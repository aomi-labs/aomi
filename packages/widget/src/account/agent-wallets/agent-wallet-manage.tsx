"use client";

import { useState } from "react";
import {
  Archive,
  ArchiveRestore,
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
import { cn } from "@aomi-labs/react";
import { AomiSheet } from "@/ui/aomi/aomi-sheet";
import { aomiButton } from "@/ui/aomi/button";
import { ListGroup, ListRow } from "@/ui/aomi/list-group";
import { SectionHeader } from "@/ui/aomi/section-header";
import { Segmented } from "@/ui/aomi/segmented";
import { StatusPill } from "@/ui/aomi/status-pill";
import { Switch } from "@/ui/aomi/switch";
import { ActionRow } from "@/ui/aomi/action-row";
import { SheetHeader } from "@/wallet/picker/sheet-parts";
import type { WalletFamily } from "@/wallet/types";
import { BrandMark, CopyButton } from "@/account/account-management/controls";
import {
  AGENT_WALLET,
  familyTag,
} from "@/account/account-management/wallet-model";
import { usedLabel } from "@/account/connections/connections-settings";
import { ConnectionLanes } from "@/account/connections/connection-lanes";
import { explorerUrl } from "@/thread/explorer-links";
import { AddressQr } from "./address-qr";
import { FamilyLabel } from "./family-label";
import { EVM_NETWORKS, familyName } from "./agent-wallet-model";
import { useRenameWallet, type AgentWalletActions } from "./agent-wallet-row";

/**
 * Account › agent wallet › Manage: its addresses behind one Receive row,
 * every connection with its lane on it, then Send, Rename and Pause as rows,
 * and Archive alone at the bottom. Changes save at once.
 */
export function AgentWalletManage({
  wallet,
  pausedAll,
  pending,
  onClose,
  onSend,
  onRename,
  onPause,
  onArchive,
}: {
  wallet: AomiAgentWallet;
  pausedAll: boolean;
  /** A wallet write is in flight. */
  pending: boolean;
  onClose: () => void;
  onSend: () => void;
  onRename: AgentWalletActions["onRename"];
  onPause: (paused: boolean) => void;
  onArchive: (archive: boolean) => void;
}) {
  const { renameWallet, dialog: renameDialog } = useRenameWallet(onRename);
  const [receive, setReceive] = useState<WalletFamily | null>(null);
  const archived = wallet.archived_at !== null;
  const paused = wallet.paused || pausedAll;
  const addresses = wallet.addresses;

  if (receive)
    return (
      <ReceiveStep
        wallet={wallet}
        family={receive}
        onFamily={setReceive}
        onBack={() => setReceive(null)}
        onClose={onClose}
      />
    );

  return (
    <AomiSheet onClose={onClose}>
      <SheetHeader
        leading={
          <BrandMark
            brand={AGENT_WALLET}
            dot={paused ? "off" : "on"}
            dim={paused}
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

        <ConnectionLanes
          agentWallet={archived ? undefined : wallet}
          brand="Aomi"
          disabled={paused}
          onClose={onClose}
        />
        {paused ? (
          <p className="type-meta text-aomi-muted -mt-2 flex items-start gap-1.5">
            <Pause className="mt-px size-3.5 shrink-0" />
            Paused: nothing signs, whatever these say, until you resume.
          </p>
        ) : null}

        <ListGroup>
          <ActionRow icon={ArrowUpRight} label="Send" step onClick={onSend} />
          {archived ? null : (
            <ActionRow
              icon={Pencil}
              label="Rename"
              step
              onClick={() => renameWallet(wallet)}
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
      {renameDialog}
    </AomiSheet>
  );
}

/** Receive: a tab per family (only with two), the QR, the address, its networks. */
export function ReceiveStep({
  wallet,
  family,
  onFamily,
  onBack,
  onClose,
}: {
  wallet: {
    name: string;
    addresses: readonly { family: WalletFamily; address: string }[];
  };
  family: WalletFamily;
  onFamily: (family: WalletFamily) => void;
  onBack: () => void;
  onClose: () => void;
}) {
  const address = wallet.addresses.find((entry) => entry.family === family);
  const explorer = address
    ? explorerUrl(
        family === "evm" ? 1 : "mainnet-beta",
        "address",
        address.address,
      )
    : null;
  return (
    <AomiSheet onClose={onClose}>
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
              label: <FamilyLabel family={entry.family} />,
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
                  <>
                    <CopyButton
                      value={address.address}
                      label={`Copy ${familyName(family)} address`}
                    />
                    {explorer ? (
                      <a
                        href={explorer}
                        target="_blank"
                        rel="noreferrer"
                        aria-label="View on explorer"
                        className={aomiButton({
                          variant: "ghost",
                          size: "icon-sm",
                        })}
                      >
                        <ArrowUpRight size={14} />
                      </a>
                    ) : null}
                  </>
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
    </AomiSheet>
  );
}
