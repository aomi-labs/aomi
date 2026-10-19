"use client";

import { useState } from "react";
import { Archive, Lock, Plug } from "lucide-react";
import type { AomiAgentWallets } from "@aomi-labs/client";
import { useDisplayQuery } from "@aomi-labs/react";
import { AomiButton } from "@/ui/aomi/button";
import { useShellTransport } from "@/account/transport";
import { agentWalletsQuery, connectionsQuery } from "@/account/account-queries";
import { useRefreshWallets } from "@/account/agent-wallets/use-refresh-wallets";
import { ConnectionManage } from "@/account/connections/connection-manage";
import type { WalletRefusal } from "./wallet-refusal";

/**
 * The card for a refused trade: paused (Resume), archived (Restore) or a
 * connection without access (Allow access → that connection's Manage
 * sheet). Nothing was signed in any case.
 */
export function WalletRefusalCard({ refusal }: { refusal: WalletRefusal }) {
  const { client } = useShellTransport();
  const wallets = useDisplayQuery(agentWalletsQuery(client));
  const connections = useDisplayQuery(connectionsQuery(client));
  const refresh = useRefreshWallets();
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">(
    "idle",
  );
  const [allowing, setAllowing] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const wallet = wallets.data?.wallets.find(
    (candidate) => candidate.id === refusal.walletId,
  );
  const name = wallet?.name ?? refusal.walletName;
  const quoted = name ? `"${name}"` : "This agent wallet";
  const connection = connections.data?.connections.find(
    (row) => row.key === refusal.connectionKey,
  );
  if (dismissed) return null;

  const fix = async (list: AomiAgentWallets) => {
    setState("busy");
    try {
      if (refusal.kind === "archived" && wallet)
        await client.account.wallets.updateAgentWallet(wallet.id, {
          archived: false,
        });
      if (refusal.kind === "paused" && wallet?.paused)
        await client.account.wallets.updateAgentWallet(wallet.id, {
          paused: false,
        });
      if (refusal.kind === "paused" && list.pause_all)
        await client.account.wallets.setAgentRule({
          locked: false,
          version: list.version,
        });
      await refresh();
      setState("done");
    } catch {
      setState("error");
    }
  };

  const [icon, title, body] =
    refusal.kind === "no_access"
      ? [
          <Plug key="icon" className="text-aomi-accent-strong size-4" />,
          `${connection?.name ?? "This client"} can’t use ${name ? `"${name}"` : "this agent wallet"} yet`,
          "Nothing was signed. Allow it to use the wallet, then ask again.",
        ]
      : refusal.kind === "archived"
        ? [
            <Archive key="icon" className="text-aomi-danger size-4" />,
            `${quoted} is archived`,
            "Nothing was signed. Restore the wallet to trade from it.",
          ]
        : [
            <Lock key="icon" className="text-aomi-danger size-4" />,
            `${quoted} is paused`,
            "Nothing was signed. Resume the wallet to trade from it.",
          ];

  return (
    <div
      role="status"
      data-wallet-refusal={refusal.kind}
      className="border-aomi-border bg-aomi-raised rounded-card mt-2 flex flex-col gap-2 border p-3"
    >
      <span className="type-control flex items-center gap-2 font-medium">
        {icon}
        {title}
      </span>
      <p className="type-meta text-aomi-muted">
        {state === "done"
          ? "Done. Ask again to trade."
          : state === "error"
            ? "Couldn’t change that. Try again in Settings."
            : body}
      </p>
      {state === "done" ? null : refusal.kind === "no_access" ? (
        <div className="flex gap-2">
          <AomiButton
            variant="primary"
            size="sm"
            className="flex-1"
            disabled={!connection || !wallet}
            onClick={() => setAllowing(true)}
          >
            Allow access
          </AomiButton>
          <AomiButton
            size="sm"
            className="flex-1"
            onClick={() => setDismissed(true)}
          >
            Not now
          </AomiButton>
        </div>
      ) : (
        <AomiButton
          size="sm"
          disabled={!wallets.data || state === "busy"}
          onClick={() => wallets.data && void fix(wallets.data)}
        >
          {refusal.kind === "archived" ? "Restore" : "Resume"}
        </AomiButton>
      )}
      {allowing && connection ? (
        <ConnectionManage
          connection={connection}
          description="Tick the wallet it may use"
          onClose={() => setAllowing(false)}
        />
      ) : null}
    </div>
  );
}
