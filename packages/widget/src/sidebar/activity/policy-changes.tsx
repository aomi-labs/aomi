"use client";

import { useCallback, useEffect, useState } from "react";
import {
  enforcementKey,
  type AomiPolicyChange,
  type AomiPolicyCatalog,
  type AomiWalletPolicies,
} from "@aomi-labs/client";
import { useShellAomi } from "@/account/transport";
import { RuleChangeCard } from "@/account/rules/rule-change-card";
import { PolicyRow } from "@/account/policies/policies-view";
import { policyRows, policySummary } from "@/account/policies/policy-model";
import { useRuleEnforcement } from "@/account/policies/policy-enforcement";
import { ListGroup } from "@/ui/aomi/list-group";

/** The changes in `ids` still waiting for the owner; replaced, decided or unreadable ones drop out. */
export function usePolicyChanges(ids: readonly string[]) {
  const aomi = useShellAomi();
  const [changes, setChanges] = useState<AomiPolicyChange[]>([]);
  const [reloads, setReloads] = useState(0);
  const key = ids.join(",");
  useEffect(() => {
    let live = true;
    if (!key) {
      setChanges([]);
      return;
    }
    Promise.all(
      key
        .split(",")
        .map((id) => aomi.account.policy.getChange(id).catch(() => null)),
    ).then((read) => {
      if (live)
        setChanges(
          read.filter(
            (change): change is AomiPolicyChange =>
              change?.state === "awaiting_admin",
          ),
        );
    });
    return () => {
      live = false;
    };
  }, [aomi, key, reloads]);
  return {
    changes,
    reload: useCallback(() => setReloads((count) => count + 1), []),
    drop: useCallback(
      (id: string) =>
        setChanges((held) => held.filter((change) => change.id !== id)),
      [],
    ),
  };
}

/** One waiting policy change as the right panel shows it: the same card as Settings › Policies. */
export function PolicyChangeCard({
  change,
  onDecided,
  onStale,
}: {
  change: AomiPolicyChange;
  onDecided: (id: string) => void;
  onStale: () => void;
}) {
  const aomi = useShellAomi();
  return (
    <RuleChangeCard
      change={change}
      client={aomi}
      className="w-full"
      onDecided={() => onDecided(change.id)}
      onStale={onStale}
    />
  );
}

/** The wallets the agent set rules on, with the rules still waiting for the owner's on-chain signature. */
export function usePolicyWallets(filings: readonly string[]) {
  const aomi = useShellAomi();
  const [rules, setRules] = useState<Record<string, AomiWalletPolicies>>({});
  const [catalog, setCatalog] = useState<AomiPolicyCatalog | null>(null);
  const [reloads, setReloads] = useState(0);
  const key = filings.join(",");
  const ids = [...new Set(filings)];
  useEffect(() => {
    let live = true;
    if (!key) {
      setRules({});
      return;
    }
    Promise.all(
      [...new Set(key.split(","))].map((id) =>
        aomi.account.policy.get(id).then(
          (read) => [id, read] as const,
          () => null,
        ),
      ),
    ).then((read) => {
      if (live)
        setRules(
          Object.fromEntries(
            read.filter(
              (entry): entry is [string, AomiWalletPolicies] => !!entry,
            ),
          ),
        );
    });
    return () => {
      live = false;
    };
  }, [aomi, key, reloads]);
  const wantCatalog = Boolean(key);
  useEffect(() => {
    if (!wantCatalog || catalog) return;
    let live = true;
    aomi.account.policy.catalog().then(
      (read) => live && setCatalog(read),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [aomi, wantCatalog, catalog]);
  const signing = ids
    .map((id) => rules[id])
    .filter((wallet): wallet is AomiWalletPolicies => Boolean(wallet))
    .map((wallet) => ({
      rules: wallet,
      rows: policyRows(wallet, catalog).filter(
        (policy) => policy.enforcement.deploy,
      ),
    }))
    .filter((wallet) => wallet.rows.length > 0);
  return {
    signing,
    catalog,
    reload: useCallback(() => setReloads((count) => count + 1), []),
    update: useCallback(
      (next: AomiWalletPolicies) =>
        setRules((held) => ({ ...held, [next.agent_wallet_id]: next })),
      [],
    ),
  };
}

/** One wallet's policies waiting for the owner's on-chain signature, as in Settings › Policies. */
export function WalletSignatures({
  wallet,
  rows,
  onRules,
  onStale,
}: {
  wallet: AomiWalletPolicies;
  rows: ReturnType<typeof policyRows>;
  onRules: (rules: AomiWalletPolicies) => void;
  onStale: () => void;
}) {
  const aomi = useShellAomi();
  const enforcement = useRuleEnforcement({
    client: aomi,
    walletId: wallet.agent_wallet_id,
    revision: wallet.revision,
    onRules,
    onStale,
  });
  return (
    <div data-policy-signatures={wallet.agent_wallet_id}>
      <p className="type-meta text-aomi-muted mb-2 px-1">
        {wallet.wallet_name}
      </p>
      <ListGroup>
        {rows.map((policy) => {
          const entry = wallet.enforcement.find(
            (candidate) =>
              enforcementKey(candidate) === policy.enforcement.deploy,
          );
          return (
            <PolicyRow
              key={policy.id}
              policy={policy}
              deploy={
                entry
                  ? enforcement.step(entry, policySummary(policy))
                  : undefined
              }
            />
          );
        })}
      </ListGroup>
    </div>
  );
}
