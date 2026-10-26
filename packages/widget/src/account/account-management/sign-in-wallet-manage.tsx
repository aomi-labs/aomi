"use client";

import { useState } from "react";
import { ChevronRight, Pencil, QrCode } from "lucide-react";
import { shortAddress } from "@aomi-labs/client";
import { AomiSheet } from "@/ui/aomi/aomi-sheet";
import { ListGroup } from "@/ui/aomi/list-group";
import { ActionRow } from "@/ui/aomi/action-row";
import { useRenameDialog } from "@/ui/aomi/rename-dialog";
import { SheetFootnote, SheetHeader } from "@/wallet/picker/sheet-parts";
import type { WalletFamily } from "@/wallet/types";
import type { WalletRow } from "@/wallet/composer/wallet-state";
import { ReceiveStep } from "@/account/agent-wallets/agent-wallet-manage";
import { ConnectionLanes } from "@/account/connections/connection-lanes";
import { BrandMark } from "./controls";
import { familyTag } from "./wallet-model";
import type { ManagedWallet } from "./wallet-rows";

/**
 * Account › sign-in wallet › Manage: the agent wallet's sheet, minus what
 * Aomi can't do for a wallet it holds no key for. Receive, every connection
 * (each signs in the wallet itself) and Rename when the wallet is linked.
 */
export function SignInWalletManage({
  wallet,
  onRename,
  onClose,
}: {
  wallet: ManagedWallet;
  onRename?: (row: WalletRow, label: string | null) => Promise<boolean>;
  onClose: () => void;
}) {
  const { rename, dialog } = useRenameDialog();
  const [receive, setReceive] = useState<WalletFamily | null>(null);
  const addresses = wallet.rows.map((row) => ({
    family: row.family,
    address: row.address,
  }));
  const linked = wallet.rows.find((row) => row.linkedWalletId);
  if (receive)
    return (
      <ReceiveStep
        wallet={{ name: wallet.name, addresses }}
        family={receive}
        onFamily={setReceive}
        onBack={() => setReceive(null)}
        onClose={onClose}
      />
    );
  return (
    <AomiSheet onClose={onClose}>
      <SheetHeader
        leading={<BrandMark brand={wallet.brand} dot="on" />}
        title={wallet.name}
        description={`Sign-in wallet · ${addresses
          .map((entry) => familyTag(entry.family))
          .join(" + ")}`}
        onClose={onClose}
      />
      <div className="flex min-h-0 flex-col gap-4 overflow-y-auto px-5 pb-5">
        <ListGroup>
          <button
            type="button"
            onClick={() => setReceive(addresses[0]!.family)}
            className="hover:bg-aomi-hover flex min-h-14 w-full items-center gap-3 px-3.5 text-left transition-colors"
          >
            <QrCode className="text-aomi-muted size-4 shrink-0" />
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="type-row">Receive</span>
              <span className="type-address text-aomi-muted truncate">
                {addresses
                  .map((entry) => shortAddress(entry.address))
                  .join(" · ")}
              </span>
            </span>
            <ChevronRight className="text-aomi-muted size-4 shrink-0" />
          </button>
        </ListGroup>
        <ConnectionLanes brand={wallet.brand} onClose={onClose} />
        {linked && onRename ? (
          <ListGroup>
            <ActionRow
              icon={Pencil}
              label="Rename"
              step
              onClick={() =>
                rename({
                  title: "Rename wallet",
                  description: `Only you see this name. Leave it empty to show "${wallet.brand}".`,
                  value: linked.label ?? "",
                  placeholder: wallet.brand,
                  allowEmpty: true,
                  onSave: (label) => onRename(linked, label || null),
                })
              }
            />
          </ListGroup>
        ) : null}
        <SheetFootnote>
          Every trade from {wallet.name} opens {wallet.brand} to sign.
        </SheetFootnote>
      </div>
      {dialog}
    </AomiSheet>
  );
}
