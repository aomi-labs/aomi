"use client";

import { useCallback, useEffect, useState } from "react";
import type { AomiRuleChange } from "@aomi-labs/client";
import { useShellAomi } from "@/account/transport";
import { RuleChangeCard } from "@/account/rules/rule-change-card";

/**
 * The changes in `ids` that still wait for the owner. A change another filing
 * replaced, or that the owner decided, is not open any more and drops out;
 * one that cannot be read (a guest chat, another account) is not shown.
 */
export function usePolicyChanges(ids: readonly string[]) {
  const aomi = useShellAomi();
  const [changes, setChanges] = useState<AomiRuleChange[]>([]);
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
        .map((id) => aomi.account.rules.getChange(id).catch(() => null)),
    ).then((read) => {
      if (live)
        setChanges(
          read.filter(
            (change): change is AomiRuleChange =>
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
  change: AomiRuleChange;
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
