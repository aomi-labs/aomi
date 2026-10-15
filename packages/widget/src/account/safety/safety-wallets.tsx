"use client";

import { useEffect, useState } from "react";
import { UserState, type AomiAccountWallet } from "@aomi-labs/client";
import { useShellTransport } from "../transport";
import { useAccountAcl } from "../use-account-acl";
import { LockedWalletsView } from "../account-signing";
import { useAgentWallets } from "../account-management/use-agent-wallets";
import { AgentWalletRuleCard, ruleCardTitle } from "./agent-wallet-rules";
import { ConnectedApps } from "./connected-apps";

const sameKey = (
  wallet: AomiAccountWallet,
  chain: "evm" | "svm",
  address: string,
) =>
  wallet.family === chain &&
  UserState.sameAddress({ chain, address }, { chain, address: wallet.address });

/**
 * The Safety tab below Guard policy: one rule card per agent wallet, legacy
 * Locked wallets with Unlock, and Connected apps. Loaded on first visit.
 */
export function SafetyWallets({
  onLoad,
  focusWallet,
}: {
  onLoad?: () => void;
  /** `w_` id of the agent wallet to scroll to. */
  focusWallet?: string;
}) {
  const { client } = useShellTransport();
  const agents = useAgentWallets(client);
  const acl = useAccountAcl();
  const [appsLoaded, setAppsLoaded] = useState(false);
  const loaded =
    agents.status !== "loading" && acl.status !== "loading" && appsLoaded;
  useEffect(() => {
    if (loaded) onLoad?.();
  }, [loaded, onLoad]);

  const wallets = agents.wallets ?? [];
  // Browser and embedded wallets ask in the wallet itself; only one Locked
  // before agent wallets (and not a Paused agent key) still needs a control.
  const locked = acl.wallets.filter(
    (policy) =>
      policy.desiredMode === "denied" &&
      !policy.providerManaged &&
      !wallets.some((wallet) => sameKey(wallet, policy.chain, policy.address)),
  );
  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-6">
        {wallets.map((wallet) => (
          <AgentWalletRuleCard
            key={wallet.id}
            client={client}
            wallet={wallet}
            title={ruleCardTitle(wallet, wallets.length > 1)}
            focused={wallet.id === focusWallet}
          />
        ))}
        <p className="type-meta text-aomi-muted px-0.5">
          Browser and embedded wallets always ask in the wallet itself, so they
          have nothing to set here.
        </p>
      </div>
      {acl.status === "error" ? (
        <p role="alert" className="type-meta text-aomi-danger">
          {acl.error ?? "Could not load your signing settings."}
        </p>
      ) : locked.length ? (
        <LockedWalletsView
          wallets={locked}
          onCommit={acl.commitMode}
          onPrepare={acl.prepareMode}
          blockedReason={acl.blockedReason}
        />
      ) : null}
      <ConnectedApps client={client} onLoad={() => setAppsLoaded(true)} />
    </div>
  );
}
