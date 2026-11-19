"use client";

import { useContext, useEffect, useState } from "react";
import type { AomiWalletRules } from "@aomi-labs/client";
import { useDisplayQuery } from "@aomi-labs/react";
import { connectionsQuery } from "@/account/account-queries";
import {
  requestSettingsOpen,
  SettingsNavContext,
  type SettingsTab,
} from "@/account/settings-events";
import { useShellAomi } from "@/account/transport";
import { AomiButton } from "@/ui/aomi/button";
import { WalletPolicySummary } from "./policies-view";
import { activePolicyCount } from "./policy-model";

/**
 * An agent wallet's Manage sheet: connection and policy counts linking to
 * their Settings tabs, and any policy change waiting for approval.
 */
export function AgentWalletPolicySummary({
  wallet,
  filed,
  onClose,
}: {
  wallet: { id: string };
  /** Rules another control just filed a change on (an ask mode made Instant). */
  filed?: AomiWalletRules | null;
  onClose: () => void;
}) {
  const aomi = useShellAomi();
  const goTo = useContext(SettingsNavContext);
  const connections = useDisplayQuery(connectionsQuery(aomi));
  const [read, setRead] = useState<AomiWalletRules | null>(null);
  useEffect(() => {
    let live = true;
    aomi.account.rules.get(wallet.id).then(
      (next) => live && setRead(next),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [aomi, wallet.id]);
  // A change filed from this sheet is newer than what was read.
  const rules = filed ?? read;
  const open = (tab: SettingsTab) => {
    onClose();
    if (goTo) goTo(tab);
    else requestSettingsOpen(tab);
  };
  return (
    <section
      aria-label="Connections and policies"
      className="flex flex-col gap-2"
    >
      {rules?.pending ? (
        <div
          role="status"
          data-pending-change={rules.pending.id}
          className="rounded-card border-aomi-border bg-aomi-raised flex flex-wrap items-center justify-between gap-2 border p-3"
        >
          <p className="type-control min-w-0 flex-1">
            A policy change is waiting for approval.
          </p>
          <AomiButton
            variant="primary"
            size="sm"
            onClick={() => open("policies")}
          >
            Review in Policies
          </AomiButton>
        </div>
      ) : null}
      <WalletPolicySummary
        // The portal is this website: it is not a connection to manage.
        connections={
          (connections.data?.connections ?? []).filter(
            (connection) => connection.kind !== "portal",
          ).length
        }
        policies={rules ? activePolicyCount(rules) : null}
        onConnections={() => open("connections")}
        onPolicies={() => open("policies")}
      />
    </section>
  );
}
