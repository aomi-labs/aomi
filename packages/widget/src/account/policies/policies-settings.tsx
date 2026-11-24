"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  enforcementKey,
  policyKey,
  upsertPolicy,
  type AomiPolicyCatalog,
  type AomiPolicyChangeRequest,
  type AomiWalletPolicies,
} from "@aomi-labs/client";
import { useDisplayQuery } from "@aomi-labs/react";
import { BrandMark } from "@/account/account-management/controls";
import {
  AGENT_WALLET,
  appName,
  rowEmail,
} from "@/account/account-management/wallet-model";
import { agentWalletsQuery } from "@/account/account-queries";
import { useRefreshWallets } from "@/account/agent-wallets/use-refresh-wallets";
import { PolicyChangeCard } from "@/account/policies/policy-change-card";
import {
  policyErrorCode,
  policyFailure,
  sameWallet,
  timeUntil,
} from "@/account/policies/policy-format";
import type { PolicyFocus } from "@/account/settings-events";
import { useShellAomi } from "@/account/transport";
import { AomiButton } from "@/ui/aomi/button";
import { ListGroup } from "@/ui/aomi/list-group";
import { LoadingPane } from "@/ui/aomi/loading-pane";
import { useAomiWalletKit } from "@/wallet/context";
import type { AomiWalletKit } from "@/wallet/types";
import { usePolicyEnforcement } from "./policy-enforcement";
import { PoliciesView, WalletPolicyCard } from "./policies-view";
import { WalletVaultRows } from "./vault-rows";
import {
  adminOf,
  authorityOf,
  draftPolicies,
  policyCatalog,
  policyProviders,
  policyRows,
  policySummary,
  removalSummary,
  removedPolicies,
  type PolicyAuthorityWallet,
  type PolicyCatalog,
  type WalletPolicies,
} from "./policy-model";

type Aomi = ReturnType<typeof useShellAomi>;

type Held = {
  policies: AomiWalletPolicies | null;
  failed: boolean;
  saving: boolean;
  notice: string | null;
  error: string | null;
  /** Bumped per answered save to reset pickers and drafts. */
  epoch: number;
  /** The waiting change was put aside. */
  later: boolean;
};

const EMPTY: Held = {
  policies: null,
  failed: false,
  saving: false,
  notice: null,
  error: null,
  epoch: 0,
  later: false,
};

/** Each wallet's policies; a read older than a newer write cannot overwrite it. */
function useWalletPolicies(aomi: Aomi, ids: readonly string[]) {
  const [book, setBook] = useState<Record<string, Held>>({});
  const live = useRef(true);
  const versions = useRef<Record<string, number>>({});
  const started = useRef(new Set<string>());
  const saving = useRef(new Set<string>());
  const refreshWallets = useRefreshWallets();

  const patch = useCallback(
    (id: string, next: Partial<Held> | ((held: Held) => Partial<Held>)) =>
      setBook((held) => {
        const current = held[id] ?? EMPTY;
        return {
          ...held,
          [id]: {
            ...current,
            ...(typeof next === "function" ? next(current) : next),
          },
        };
      }),
    [],
  );
  const bump = (id: string) =>
    (versions.current[id] = (versions.current[id] ?? 0) + 1);

  const load = useCallback(
    async (id: string) => {
      const version = (versions.current[id] = (versions.current[id] ?? 0) + 1);
      try {
        const next = await aomi.account.policy.get(id);
        if (!live.current || version !== versions.current[id]) return null;
        patch(id, { policies: next, failed: false });
        return next;
      } catch {
        if (live.current && version === versions.current[id])
          patch(id, { failed: true });
        return null;
      }
    },
    [aomi, patch],
  );

  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  const key = ids.join("\n");
  useEffect(() => {
    for (const id of key ? key.split("\n") : []) {
      if (started.current.has(id)) continue;
      started.current.add(id);
      void load(id);
    }
  }, [key, load]);

  const reload = useCallback(() => {
    for (const id of started.current) void load(id);
  }, [load]);

  const fail = (id: string, caught: unknown, fallback: string) => {
    if (!live.current) return;
    patch(id, { error: policyFailure(caught, fallback) });
    if (policyErrorCode(caught) === "rules_changed") void load(id);
  };

  const save = async (id: string, request: AomiPolicyChangeRequest) => {
    if (saving.current.has(id)) return;
    saving.current.add(id);
    patch(id, { saving: true, error: null, notice: null });
    try {
      const result = await aomi.account.policy.change(id, request);
      if (!live.current) return;
      bump(id);
      patch(id, (held) => ({
        policies: result.rules,
        epoch: held.epoch + 1,
        // A change that waits opens its card at the top.
        later:
          result.status === "waiting" && result.rules.pending
            ? false
            : held.later,
        notice:
          result.status === "applied"
            ? "Saved"
            : result.status === "waiting" && result.rules.pending
              ? "Waiting for approval"
              : null,
      }));
    } catch (caught) {
      fail(id, caught, "Couldn’t save that. Try again.");
    } finally {
      saving.current.delete(id);
      if (live.current) patch(id, { saving: false });
    }
  };

  const decided = (
    id: string,
    next: AomiWalletPolicies,
    outcome: "approved" | "declined",
  ) => {
    bump(id);
    patch(id, {
      policies: next,
      later: false,
      error: null,
      notice: outcome === "approved" ? "Approved" : "Declined",
    });
    // An approved change can turn a connection Instant.
    void refreshWallets();
  };

  const decline = async (id: string, changeId: string) => {
    if (saving.current.has(id)) return;
    saving.current.add(id);
    patch(id, { saving: true, error: null });
    try {
      decided(
        id,
        await aomi.account.policy.declineChange(changeId),
        "declined",
      );
    } catch (caught) {
      fail(id, caught, "Couldn’t decline that. Try again.");
      if (policyErrorCode(caught) === "rules_change_not_open") void load(id);
    } finally {
      saving.current.delete(id);
      if (live.current) patch(id, { saving: false });
    }
  };

  const stale = (id: string) =>
    void load(id).then((next) => {
      if (!next || next.pending) return;
      patch(id, { later: false, notice: "That change was already decided" });
    });

  /** A late step answer cannot undo a newer write. */
  const stepped = (id: string, next: AomiWalletPolicies) => {
    bump(id);
    patch(id, (held) => ({
      policies:
        held.policies && next.revision < held.policies.revision
          ? held.policies
          : next,
    }));
  };

  return { book, load, reload, save, decided, decline, stale, stepped, patch };
}

/**
 * Signed-in, non-agent wallets that can sign approvals; the current
 * authority stays listed either way.
 */
function authorityWallets(
  policies: AomiWalletPolicies,
  kit: Pick<AomiWalletKit, "wallets">,
): PolicyAuthorityWallet[] {
  const { admin } = policies;
  const options =
    admin.kind === "wallet" &&
    !policies.admin_wallets.some((wallet) =>
      sameWallet(wallet, admin.family, admin.address),
    )
      ? [admin, ...policies.admin_wallets]
      : policies.admin_wallets;
  return options.flatMap((wallet) => {
    const row = kit.wallets.find((entry) =>
      sameWallet(wallet, entry.family, entry.address),
    );
    const current =
      admin.kind === "wallet" &&
      sameWallet(wallet, admin.family, admin.address);
    if (row?.kind === "agent") return [];
    if (!current && !row?.connected) return [];
    return [
      {
        brand: row ? appName(row) : "Wallet",
        address: wallet.address,
        login: row ? (rowEmail(row) ?? row.label) : undefined,
        family: wallet.family === "evm" ? ("EVM" as const) : ("SVM" as const),
      },
    ];
  });
}

/**
 * Settings › Policies. Each edit sends the full new rule set: tightening
 * saves at once, loosening waits for approval.
 */
export function PoliciesSettings({
  active = true,
  focus,
}: {
  /** False while another Settings tab is in front. */
  active?: boolean;
  /** The wallet, and the policy on it, a link pointed at. */
  focus?: PolicyFocus;
}) {
  const aomi = useShellAomi();
  const kit = useAomiWalletKit();
  const agents = useDisplayQuery(agentWalletsQuery(aomi));
  const wallets = useMemo(
    () =>
      (agents.data?.wallets ?? []).filter(
        (wallet) => wallet.archived_at === null,
      ),
    [agents.data],
  );
  const held = useWalletPolicies(
    aomi,
    useMemo(() => wallets.map((wallet) => wallet.id), [wallets]),
  );
  const [catalog, setCatalog] = useState<AomiPolicyCatalog | null>(null);
  const [catalogFailed, setCatalogFailed] = useState(false);
  const live = useRef(true);

  const loadCatalog = useCallback(() => {
    setCatalogFailed(false);
    aomi.account.policy.catalog().then(
      (next) => live.current && setCatalog(next),
      () => live.current && setCatalogFailed(true),
    );
  }, [aomi]);
  useEffect(() => {
    live.current = true;
    loadCatalog();
    return () => {
      live.current = false;
    };
  }, [loadCatalog]);

  // Another tab or the wallet's own sheet may have filed a change meanwhile.
  const shown = useRef(active);
  const { reload } = held;
  useEffect(() => {
    if (active && !shown.current) reload();
    shown.current = active;
  }, [active, reload]);

  const picker = useMemo(
    () => (catalog ? policyCatalog(catalog) : null),
    [catalog],
  );

  if (!agents.data)
    return agents.isError ? (
      <p className="type-meta text-aomi-muted flex items-center gap-2">
        Couldn’t load your agent wallets.
        <button
          type="button"
          onClick={() => void agents.refetch()}
          className="hover:text-aomi-fg underline underline-offset-2"
        >
          Try again
        </button>
      </p>
    ) : (
      <LoadingPane label="Loading policies" />
    );

  const waiting = wallets.flatMap((wallet) => {
    const one = held.book[wallet.id];
    const pending = one?.policies?.pending;
    return one && pending ? [{ wallet, held: one, pending }] : [];
  });

  return (
    <PoliciesView
      changes={
        waiting.length
          ? waiting.map(({ wallet, held: one, pending }) =>
              one.later ? (
                <PendingLine
                  key={pending.id}
                  change={pending}
                  saving={one.saving}
                  onDecline={() => void held.decline(wallet.id, pending.id)}
                  onReview={() => held.patch(wallet.id, { later: false })}
                />
              ) : (
                <PolicyChangeCard
                  key={pending.id}
                  change={pending}
                  client={aomi}
                  onDecided={(next, outcome) =>
                    held.decided(wallet.id, next, outcome)
                  }
                  onLater={() => held.patch(wallet.id, { later: true })}
                  onStale={() => held.stale(wallet.id)}
                />
              ),
            )
          : undefined
      }
    >
      {wallets.length === 0 ? (
        <p className="type-meta text-aomi-muted px-0.5">
          No agent wallets yet. Policies appear here once you have one.
        </p>
      ) : null}
      {wallets.map((wallet) => {
        const one = held.book[wallet.id] ?? EMPTY;
        return one.policies ? (
          <LiveWalletCard
            key={wallet.id}
            aomi={aomi}
            kit={kit}
            wallet={wallet}
            held={one}
            walletPolicies={one.policies}
            focus={
              focus?.wallet === wallet.id ? (focus.policy ?? "") : undefined
            }
            catalog={catalog}
            picker={picker}
            onRetryCatalog={catalogFailed ? loadCatalog : undefined}
            onSave={(request) => void held.save(wallet.id, request)}
            onStepped={(next) => held.stepped(wallet.id, next)}
            onStale={() => void held.load(wallet.id)}
          />
        ) : (
          <section
            key={wallet.id}
            aria-label={`${wallet.name} policies`}
            data-wallet-policies={wallet.id}
          >
            <ListGroup>
              <div className="flex flex-col gap-3 px-3.5 py-3">
                <h3 className="type-row flex min-w-0 items-center gap-2">
                  <BrandMark brand={AGENT_WALLET} box={20} size={16} />
                  <span className="truncate">{wallet.name}</span>
                </h3>
                <p className="type-meta text-aomi-muted flex items-center gap-2">
                  {one.failed
                    ? "Couldn’t load the policies."
                    : "Loading policies…"}
                  {one.failed ? (
                    <button
                      type="button"
                      onClick={() => {
                        held.patch(wallet.id, { failed: false });
                        void held.load(wallet.id);
                      }}
                      className="hover:text-aomi-fg underline underline-offset-2"
                    >
                      Try again
                    </button>
                  ) : null}
                </p>
              </div>
            </ListGroup>
          </section>
        );
      })}
    </PoliciesView>
  );
}

function PendingLine({
  change,
  saving,
  onDecline,
  onReview,
}: {
  change: NonNullable<AomiWalletPolicies["pending"]>;
  saving: boolean;
  onDecline: () => void;
  onReview: () => void;
}) {
  const left = timeUntil(change.expires_at);
  return (
    <div
      role="status"
      data-pending-change={change.id}
      className="rounded-card border-aomi-border bg-aomi-raised flex flex-col gap-2 border p-3"
    >
      <p className="type-control">
        <span className="text-aomi-muted">
          {change.wallet_name} ·{" "}
          {change.proposed_by.startsWith("agent:")
            ? "Aomi asks:"
            : "Waiting for approval:"}
        </span>{" "}
        {change.lines[0]?.text ?? "A policy change"}
        {change.lines.length > 1
          ? ` and ${change.lines.length - 1} more`
          : null}
      </p>
      <div className="flex items-center gap-2">
        <span className="type-meta text-aomi-muted flex-1">
          {left ? `${left} left` : "expired"}
        </span>
        <AomiButton size="sm" disabled={saving} onClick={onDecline}>
          Decline
        </AomiButton>
        <AomiButton variant="primary" size="sm" onClick={onReview}>
          Review
        </AomiButton>
      </div>
    </div>
  );
}

function LiveWalletCard({
  aomi,
  kit,
  wallet,
  held,
  walletPolicies,
  focus,
  catalog,
  picker,
  onRetryCatalog,
  onSave,
  onStepped,
  onStale,
}: {
  aomi: Aomi;
  kit: Pick<AomiWalletKit, "wallets">;
  wallet: { id: string; name: string };
  held: Held;
  walletPolicies: AomiWalletPolicies;
  focus?: string;
  catalog: AomiPolicyCatalog | null;
  picker: PolicyCatalog | null;
  onRetryCatalog?: () => void;
  onSave: (request: AomiPolicyChangeRequest) => void;
  onStepped: (policies: AomiWalletPolicies) => void;
  onStale: () => void;
}) {
  const set = walletPolicies.rules;
  // Each change is built from the policies shown: a save that lost a race is
  // refused, not written over the other edit.
  const save = (request: AomiPolicyChangeRequest) =>
    onSave({ ...request, revision: walletPolicies.revision });
  const enforcement = usePolicyEnforcement({
    client: aomi,
    walletId: wallet.id,
    revision: walletPolicies.revision,
    onConfirmed: onStepped,
    onStale,
  });
  const view: WalletPolicies = {
    id: wallet.id,
    name: wallet.name,
    linkedOnly: set.linked_only,
    onlyListed: set.mode === "whitelist",
    policies: policyRows(walletPolicies, catalog),
    removed: removedPolicies(walletPolicies, catalog),
    authority: authorityOf(walletPolicies.admin),
    authorityWallets: authorityWallets(walletPolicies, kit),
    stopped: Boolean(walletPolicies.stopped_until),
  };
  return (
    <WalletPolicyCard
      wallet={view}
      focus={focus}
      catalog={picker}
      providers={policyProviders(walletPolicies)}
      vaults={
        <WalletVaultRows
          enforcement={walletPolicies.enforcement}
          catalog={picker}
        />
      }
      saving={held.saving}
      notice={held.notice}
      error={held.error}
      epoch={held.epoch}
      onRetryCatalog={onRetryCatalog}
      onLinkedOnly={(on) => save({ rules: { ...set, linked_only: on } })}
      onOnlyListed={(on) =>
        save({ rules: { ...set, mode: on ? "whitelist" : "blacklist" } })
      }
      onAdd={(draft) => {
        const added = draftPolicies(draft);
        // One change adds the policy on every picked chain.
        if (added)
          save({
            rules: { ...set, rules: added.reduce(upsertPolicy, set.rules) },
          });
      }}
      onRemove={(policy) =>
        save({
          rules: {
            ...set,
            rules: set.rules.filter(
              (rule) => !policy.policyIds.includes(rule.id ?? policyKey(rule)),
            ),
          },
        })
      }
      onAuthority={(authority) => save({ admin: adminOf(authority) })}
      deploy={(policy) => {
        const entry = walletPolicies.enforcement.find(
          (candidate) =>
            enforcementKey(candidate) === policy.enforcement.deploy,
        );
        return entry
          ? enforcement.step(entry, policySummary(policy))
          : undefined;
      }}
      takeOff={(policy) => {
        const entry = walletPolicies.enforcement.find(
          (candidate) => enforcementKey(candidate) === policy.key,
        );
        return entry
          ? enforcement.takeOff(entry, removalSummary(policy))
          : undefined;
      }}
    />
  );
}
