import type { ReactNode } from "react";
import { LayoutGrid, Pause } from "lucide-react";
import type { WalletFamily } from "@/wallet/types";
import { getAgentIcon } from "@/icons/agent-map";
import { familyList, plural } from "./wallet-model";

/**
 * The labels every wallet and connection row shares (Settings, sheets and
 * pickers alike): families in the mono face, an agent as its logo and name in
 * the grey line, and Paused as a word at the row's end.
 */

/** `EVM`, `EVM/SVM`, an address: always the mono face. */
export function Mono({ children }: { children: ReactNode }) {
  return <span className="type-address">{children}</span>;
}

/** `2 addresses · EVM/SVM` under a parent row's name. */
export function AddressSummary({
  families,
}: {
  families: readonly WalletFamily[];
}) {
  const list = familyList(families);
  return (
    <>
      {plural(families.length, "address", "addresses")}
      {list ? (
        <>
          {" · "}
          <Mono>{list}</Mono>
        </>
      ) : null}
    </>
  );
}

/**
 * The agent a wallet is used by, or a connection is locked to: its own logo
 * (the Library's artwork) and name, else the generic agent grid.
 */
export function AgentLabel({
  agent,
}: {
  agent: { name: string; label: string };
}) {
  const Icon = getAgentIcon(agent.name);
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap align-[-2px] font-sans">
      {Icon ? (
        <Icon aria-hidden className="size-3.5 shrink-0 rounded-full" />
      ) : (
        <LayoutGrid aria-hidden className="size-3 shrink-0" />
      )}
      {agent.label}
    </span>
  );
}

/** ` · <AgentLabel>` when there is an agent, for the end of a grey line. */
export const withAgent = (agent: { name: string; label: string } | null) =>
  agent ? (
    <>
      {" · "}
      <AgentLabel agent={agent} />
    </>
  ) : null;

/** Paused at a row's end, before its buttons. */
export function PausedMeta() {
  return (
    <span className="type-meta text-aomi-danger inline-flex shrink-0 items-center gap-1 whitespace-nowrap font-medium">
      <Pause aria-hidden className="size-3.5" />
      Paused
    </span>
  );
}
