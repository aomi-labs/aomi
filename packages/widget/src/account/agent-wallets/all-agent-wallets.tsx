"use client";

import { useState, type ReactNode } from "react";
import { Search } from "lucide-react";
import type { AomiAgentWallet } from "@aomi-labs/client";
import { AomiSheet } from "@/ui/aomi/aomi-sheet";
import { ListGroup, ListRow } from "@/ui/aomi/list-group";
import { Switch } from "@/ui/aomi/switch";
import { SheetHeader } from "@/wallet/picker/sheet-parts";

/** "Show all N": every unarchived wallet with search, and Pause all. */
export function AllAgentWallets({
  wallets,
  pausedAll,
  busy,
  onPauseAll,
  onClose,
  renderRow,
}: {
  wallets: readonly AomiAgentWallet[];
  pausedAll: boolean;
  busy: boolean;
  onPauseAll: (paused: boolean) => void;
  onClose: () => void;
  renderRow: (wallet: AomiAgentWallet) => ReactNode;
}) {
  const [search, setSearch] = useState("");
  const needle = search.trim().toLowerCase();
  const matches = wallets.filter(
    (wallet) =>
      !needle ||
      wallet.name.toLowerCase().includes(needle) ||
      wallet.app?.label.toLowerCase().includes(needle) ||
      wallet.addresses.some((address) =>
        address.address.toLowerCase().includes(needle),
      ),
  );
  return (
    <AomiSheet onClose={onClose}>
      <SheetHeader
        title="Agent wallets"
        description={`${wallets.length} wallets · most recently used first`}
        onClose={onClose}
      />
      <div className="flex min-h-0 flex-col gap-3 overflow-y-auto px-5 pb-5">
        <ListGroup>
          <ListRow
            title="Pause all"
            description="Nothing signs from any agent wallet until you resume"
            trailing={
              <Switch
                aria-label="Pause all agent wallets"
                checked={pausedAll}
                disabled={busy}
                onCheckedChange={onPauseAll}
              />
            }
          />
        </ListGroup>
        <label className="border-aomi-border rounded-control focus-within:border-aomi-muted flex h-9 items-center gap-2 border px-3">
          <Search className="text-aomi-muted size-4 shrink-0" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by name, app or address"
            aria-label="Search agent wallets"
            className="type-control text-aomi-fg placeholder:text-aomi-muted min-w-0 flex-1 bg-transparent outline-none"
          />
        </label>
        <div className="border-aomi-border bg-aomi-raised rounded-card overflow-hidden border">
          {matches.length ? (
            matches.map(renderRow)
          ) : (
            <p className="type-control text-aomi-muted px-3.5 py-3">
              No agent wallet matches.
            </p>
          )}
        </div>
      </div>
    </AomiSheet>
  );
}
