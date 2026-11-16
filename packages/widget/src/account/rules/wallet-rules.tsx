"use client";

import { cn } from "@/lib/cn";
import { useCallback, useEffect, useRef, useState } from "react";
import { Hand, Plus, X } from "lucide-react";
import {
  ruleKey,
  type AomiRule,
  type AomiRuleSet,
  type AomiRuleTo,
  type AomiRuleUsage,
  type AomiRulesAdmin,
  type AomiRulesCatalog,
  type AomiRulesChangeRequest,
  type AomiRulesMode,
  type AomiWalletRules,
} from "@aomi-labs/client";
import { AomiButton, aomiButton } from "@/ui/aomi/button";
import { ListGroup } from "@/ui/aomi/list-group";
import { SectionHeader } from "@/ui/aomi/section-header";
import { Segmented } from "@/ui/aomi/segmented";
import { StatusPill } from "@/ui/aomi/status-pill";
import { Switch } from "@/ui/aomi/switch";
import { SheetAlert } from "@/wallet/picker/sheet-parts";
import { useAomiWalletKit } from "@/wallet/context";
import { useShellAomi } from "@/account/transport";
import { useRefreshWallets } from "@/account/agent-wallets/use-refresh-wallets";
import { RuleChangeCard, walletName } from "./rule-change-card";
import { RuleEnforcement } from "./rule-enforcement";
import {
  assetAmount,
  assetChain,
  assetNetwork,
  fromBaseUnits,
  rulesErrorCode,
  rulesFailure,
  sameAdmin,
  shortAsset,
  timeUntil,
  toBaseUnits,
  toLabel,
  usedPercent,
  validAddress,
  withRule,
} from "./rules-model";

const ROW =
  "flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-3.5 py-3";
const INPUT =
  "border-aomi-border bg-aomi-raised focus-visible:ring-aomi-ring/50 h-8 rounded-[8px] border px-2 text-[13px] outline-none focus-visible:ring-2";

const MODES: Record<AomiRulesMode, string> = {
  whitelist:
    "Only what’s listed is allowed. A send needs a rule with its address.",
  blacklist: "Everything is allowed, except what’s listed.",
};

/**
 * Wallet › Manage › Rules: what the agent may sign with this wallet. A
 * switch for sends, then the mode and its rules, each a token, an amount a
 * day and where it may go, with who enforces it. Each edit sends the full new
 * set: one that only takes power away saves at once, one that gives power
 * opens the rule change card and waits for whoever approves changes.
 */
export function WalletRules({
  wallet,
  filed,
}: {
  wallet: { id: string; name: string };
  /** Rules another control just filed a change on (a lane made Instant). */
  filed?: AomiWalletRules | null;
}) {
  const aomi = useShellAomi();
  const kit = useAomiWalletKit();
  const refreshWallets = useRefreshWallets();
  const [rules, setRules] = useState<AomiWalletRules | null>(null);
  const [catalog, setCatalog] = useState<AomiRulesCatalog | null>(null);
  const [catalogFailed, setCatalogFailed] = useState(false);
  const [failed, setFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Bumped after each answered save, so the rule editor starts empty again.
  const [epoch, setEpoch] = useState(0);
  const live = useRef(true);
  const card = useRef<HTMLDivElement>(null);
  // Bumped by every newer source of rules (a save, a decision, a filed
  // change), so a read that started before it cannot overwrite it.
  const version = useRef(0);

  const load = useCallback(async () => {
    const started = ++version.current;
    try {
      const next = await aomi.account.rules.get(wallet.id);
      if (!live.current || started !== version.current) return null;
      setRules(next);
      setFailed(false);
      return next;
    } catch {
      if (live.current && started === version.current) setFailed(true);
      return null;
    }
  }, [aomi, wallet.id]);

  const loadCatalog = useCallback(() => {
    setCatalogFailed(false);
    aomi.account.rules.catalog().then(
      (next) => live.current && setCatalog(next),
      () => live.current && setCatalogFailed(true),
    );
  }, [aomi]);

  useEffect(() => {
    live.current = true;
    void load();
    loadCatalog();
    return () => {
      live.current = false;
    };
  }, [load, loadCatalog]);

  useEffect(() => {
    if (!filed) return;
    version.current += 1;
    setRules(filed);
    if (filed.pending) setReviewing(true);
  }, [filed]);

  useEffect(() => {
    if (reviewing) card.current?.scrollIntoView?.({ block: "nearest" });
  }, [reviewing]);

  const fail = (caught: unknown, fallback: string) => {
    if (!live.current) return;
    setError(rulesFailure(caught, fallback));
    if (rulesErrorCode(caught) === "rules_changed") void load();
  };

  const save = async (request: AomiRulesChangeRequest) => {
    if (saving) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const result = await aomi.account.rules.change(wallet.id, request);
      if (!live.current) return;
      version.current += 1;
      setRules(result.rules);
      setEpoch((count) => count + 1);
      if (result.status === "waiting" && result.rules.pending)
        setReviewing(true);
      else if (result.status === "applied") setNotice("Saved");
    } catch (caught) {
      fail(caught, "Couldn’t save that. Try again.");
    } finally {
      if (live.current) setSaving(false);
    }
  };

  const decided = (next: AomiWalletRules, outcome: "approved" | "declined") => {
    version.current += 1;
    setRules(next);
    setReviewing(false);
    setError(null);
    setNotice(outcome === "approved" ? "Approved" : "Declined");
    // An approved change can turn a connection Instant.
    void refreshWallets();
  };

  const decline = async (changeId: string) => {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      decided(await aomi.account.rules.declineChange(changeId), "declined");
    } catch (caught) {
      fail(caught, "Couldn’t decline that. Try again.");
      if (rulesErrorCode(caught) === "rules_change_not_open") void load();
    } finally {
      if (live.current) setSaving(false);
    }
  };

  const header = (
    <SectionHeader
      title="Rules"
      action={
        notice ? (
          <span role="status" className="type-meta font-medium">
            {notice}.
          </span>
        ) : undefined
      }
    />
  );

  if (!rules)
    return (
      <section aria-label="Rules" className="flex flex-col gap-2">
        {header}
        <p className="type-meta text-aomi-muted flex items-center gap-2">
          {failed ? "Couldn’t load the rules." : "Loading rules…"}
          {failed ? (
            <button
              type="button"
              onClick={() => void load()}
              className="hover:text-aomi-fg underline underline-offset-2"
            >
              Try again
            </button>
          ) : null}
        </p>
      </section>
    );

  const pending = rules.pending;
  const { mode, rules: list, linked_only: linkedOnly } = rules.rules;
  const left = pending ? timeUntil(pending.expires_at) : null;
  const write = (next: Partial<AomiRuleSet>) =>
    void save({ rules: { ...rules.rules, ...next } });

  return (
    <>
      <section
        aria-label="Rules"
        data-wallet-rules={wallet.id}
        className="flex flex-col gap-2"
      >
        {header}
        {rules.stopped_until ? (
          <p className="type-meta text-aomi-muted flex items-start gap-1.5">
            <Hand className="mt-px size-3.5 shrink-0" />
            Stopped by the agent until 00:00 UTC
          </p>
        ) : null}
        {pending && reviewing ? (
          <div ref={card}>
            <RuleChangeCard
              change={pending}
              client={aomi}
              onDecided={decided}
              onLater={() => setReviewing(false)}
              onStale={() =>
                void load().then((next) => {
                  if (!next || next.pending) return;
                  setReviewing(false);
                  setNotice("That change was already decided");
                })
              }
            />
          </div>
        ) : pending ? (
          <div
            role="status"
            data-pending-change={pending.id}
            className="rounded-card border-aomi-border bg-aomi-raised flex flex-col gap-2 border p-3"
          >
            <p className="type-control">
              <span className="text-aomi-muted">
                {pending.proposed_by.startsWith("agent:")
                  ? "Aomi asks:"
                  : "Waiting for approval:"}
              </span>{" "}
              {pending.lines[0]?.text ?? "A rule change"}
              {pending.lines.length > 1
                ? ` and ${pending.lines.length - 1} more`
                : null}
            </p>
            <div className="flex items-center gap-2">
              <span className="type-meta text-aomi-muted flex-1">
                {left ? `${left} left` : "expired"}
              </span>
              <AomiButton
                size="sm"
                disabled={saving}
                onClick={() => void decline(pending.id)}
              >
                Decline
              </AomiButton>
              <AomiButton
                variant="primary"
                size="sm"
                onClick={() => setReviewing(true)}
              >
                Review
              </AomiButton>
            </div>
          </div>
        ) : null}
        {error ? <SheetAlert>{error}</SheetAlert> : null}

        <ListGroup>
          <div data-rule="linked_only" className={ROW}>
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <p className="type-control">
                Only allow sending to linked wallets
              </p>
              <p className="type-meta text-aomi-muted">
                Transfers go only to wallets linked to your account. Swaps and
                protocol calls are not affected.
              </p>
            </div>
            <Switch
              aria-label="Only allow sending to linked wallets"
              checked={linkedOnly}
              disabled={saving}
              onCheckedChange={(on) => write({ linked_only: on })}
            />
          </div>
        </ListGroup>

        <ListGroup aria-busy={saving || undefined}>
          <div data-rule="mode" className={ROW}>
            <Segmented
              label="Rule mode"
              size="sm"
              value={mode}
              disabled={saving}
              onChange={(next) => write({ mode: next })}
              options={[
                { value: "whitelist", label: "Whitelist" },
                { value: "blacklist", label: "Blacklist" },
              ]}
            />
            <p className="type-meta text-aomi-muted min-w-40 flex-1 text-right">
              {MODES[mode]}
            </p>
          </div>

          {list.map((rule) => {
            const key = rule.id ?? ruleKey(rule);
            return (
              <RuleRow
                key={key}
                rule={rule}
                catalog={catalog}
                usage={rules.usage.find((entry) => entry.rule === key)}
                enforcedBy={rules.enforced_by[key] ?? ["Aomi"]}
                saving={saving}
                onRemove={() =>
                  write({
                    rules: list.filter((held) => ruleKey(held) !== key),
                  })
                }
              />
            );
          })}
          {list.length === 0 ? (
            <p className={cn(ROW, "type-meta text-aomi-muted")}>
              {mode === "whitelist"
                ? "Nothing is listed, so this wallet can’t spend anything."
                : "No rules. This wallet can spend anything."}
            </p>
          ) : null}

          <RuleEditor
            key={epoch}
            catalog={catalog}
            onRetry={catalogFailed ? loadCatalog : undefined}
            saving={saving}
            onAdd={(rule) => write({ rules: withRule(list, rule) })}
          />

          {rules.enforcement.map((entry) => (
            <RuleEnforcement
              key={`${entry.provider}:${entry.network}`}
              client={aomi}
              walletId={wallet.id}
              revision={rules.revision}
              entry={entry}
              onRules={(next) => {
                version.current += 1;
                // A step that answers late must not undo a newer write.
                setRules((current) =>
                  current && next.revision < current.revision ? current : next,
                );
              }}
              onStale={() => void load()}
            />
          ))}
        </ListGroup>
        <p className="type-meta text-aomi-muted">
          A change that restricts the agent saves at once. One that gives it
          more waits for approval. Amounts are per day and reset at 00:00 UTC.
        </p>
      </section>

      <RuleAuthority
        key={`${rules.revision}:${rules.admin.kind}`}
        admin={rules.admin}
        wallets={rules.admin_wallets}
        label={(option) => walletName(option, kit)}
        saving={saving}
        onSave={(admin) => void save({ admin })}
      />
    </>
  );
}

/** One rule: its sentence, where it applies, today's use and who enforces it. */
function RuleRow({
  rule,
  catalog,
  usage,
  enforcedBy,
  saving,
  onRemove,
}: {
  rule: AomiRule;
  catalog: AomiRulesCatalog | null;
  usage?: AomiRuleUsage;
  /** `Aomi`, then each on-chain provider that stands behind the rule. */
  enforcedBy: readonly string[];
  saving: boolean;
  onRemove: () => void;
}) {
  // A token neither the rule nor the catalog names is shown in raw units.
  const token = catalog?.tokens.find((entry) => entry.asset === rule.asset);
  const known = {
    asset: rule.asset,
    symbol: rule.symbol ?? token?.symbol,
    decimals:
      typeof rule.decimals === "number" ? rule.decimals : token?.decimals,
  };
  const name = known.symbol ?? shortAsset(rule.asset);
  const blocked = /^0+$/.test(rule.amount);
  const percent = usage ? usedPercent(usage.used, rule.amount) : 0;
  const onChain = enforcedBy.length > 1;
  return (
    <div
      data-rule="rule"
      data-rule-key={rule.id ?? ruleKey(rule)}
      className={ROW}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <p className="type-control">
          {blocked ? (
            <>
              No <strong className="font-semibold">{name}</strong>
            </>
          ) : (
            <>
              Up to{" "}
              <strong className="font-semibold">
                {assetAmount(rule.amount, known)}
              </strong>{" "}
              a day
            </>
          )}
        </p>
        <div className="flex flex-wrap items-center gap-1.5">
          <StatusPill>
            {assetChain(rule.asset, catalog ?? undefined)}
          </StatusPill>
          <StatusPill>{toLabel(rule.to, catalog)}</StatusPill>
          {usage && !blocked ? (
            <span className="type-meta text-aomi-muted flex items-center gap-1.5 tabular-nums">
              <span
                role="progressbar"
                aria-label={`${name} used today`}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={percent}
                className="bg-aomi-surface-2 inline-block h-1 w-12 overflow-hidden rounded-full"
              >
                <span
                  data-usage-tone={percent >= 80 ? "warning" : "neutral"}
                  className={cn(
                    "block h-full rounded-full",
                    percent >= 80 ? "bg-aomi-warning" : "bg-aomi-fg",
                  )}
                  style={{ width: `${percent}%` }}
                />
              </span>
              {fromBaseUnits(usage.used, known.decimals ?? 0)} used today
            </span>
          ) : null}
        </div>
      </div>
      <span className="flex items-center gap-1">
        <span data-enforced-by>
          <StatusPill tone={onChain ? "accent" : "neutral"}>
            Enforced by {enforcedBy.join(" and ")}
          </StatusPill>
        </span>
        <button
          type="button"
          aria-label={`Remove the rule for ${name} · ${toLabel(rule.to, catalog)}`}
          disabled={saving}
          onClick={onRemove}
          className={aomiButton({ variant: "ghost", size: "icon-sm" })}
        >
          <X />
        </button>
      </span>
    </div>
  );
}

type Segment = "token" | "chain" | "to";

/**
 * The new-rule field: `token / amount / chain / to`, filled in that order
 * like a date. Token, chain and `to` each open a list under the field;
 * picking one moves on to the next. A rule for an asset and destination that
 * already has one replaces its amount.
 */
function RuleEditor({
  catalog,
  onRetry,
  saving,
  onAdd,
}: {
  catalog: AomiRulesCatalog | null;
  /** Set when the catalog could not be read; reads it again. */
  onRetry?: () => void;
  saving: boolean;
  onAdd: (rule: AomiRule) => void;
}) {
  const [symbol, setSymbol] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [asset, setAsset] = useState<string | null>(null);
  const [to, setTo] = useState<AomiRuleTo | null>(null);
  const [open, setOpen] = useState<Segment | null>(null);
  const [query, setQuery] = useState("");
  const [address, setAddress] = useState("");
  const [error, setError] = useState<string | null>(null);
  const amountInput = useRef<HTMLInputElement>(null);
  const addButton = useRef<HTMLButtonElement>(null);

  const tokens = catalog?.tokens ?? [];
  const symbols = [...new Set(tokens.map((token) => token.symbol))];
  const onChains = tokens.filter((token) => token.symbol === symbol);
  const token = tokens.find((entry) => entry.asset === asset);
  const apps = (catalog?.apps ?? []).filter(
    (app) => !asset || app.chains.includes(assetNetwork(asset)),
  );
  const shown = apps.filter((app) =>
    app.label.toLowerCase().includes(query.trim().toLowerCase()),
  );

  const next = (chosen: { asset?: string | null; to?: AomiRuleTo | null }) => {
    const hasAsset = chosen.asset !== undefined ? chosen.asset : asset;
    const hasTo = chosen.to !== undefined ? chosen.to : to;
    if (!hasAsset) setOpen("chain");
    else if (!hasTo) setOpen("to");
    else {
      setOpen(null);
      addButton.current?.focus();
    }
  };

  const pickToken = (picked: string) => {
    const chains = tokens.filter((entry) => entry.symbol === picked);
    setSymbol(picked);
    setError(null);
    // A token on one chain needs no chain picked; one that moved chains
    // drops the chain and the destination chosen for the old one.
    const only = chains.length === 1 ? chains[0]!.asset : null;
    const kept = chains.find((entry) => entry.asset === asset)?.asset ?? null;
    const held = only ?? kept;
    if (held !== asset) {
      setAsset(held);
      setTo(null);
    }
    setOpen(null);
    amountInput.current?.focus();
  };

  const add = () => {
    if (!symbol || !asset || !token || !to) {
      setError("Fill in the token, amount, chain and to.");
      setOpen(!symbol ? "token" : !asset ? "chain" : "to");
      return;
    }
    const amount = toBaseUnits(draft, token.decimals);
    if (amount === null) {
      setError("Enter an amount. 0 blocks the token there.");
      amountInput.current?.focus();
      return;
    }
    setError(null);
    onAdd({ asset, amount, to });
  };

  const applyAddress = () => {
    const value = address.trim();
    if (!asset || !validAddress(asset, value)) {
      setError(
        asset
          ? `That isn’t an address on ${assetChain(asset, catalog ?? undefined)}.`
          : "Pick the token and chain first.",
      );
      return;
    }
    setError(null);
    setTo({ kind: "address", address: value });
    next({ to: { kind: "address", address: value } });
  };

  const segment = (name: Segment, value: string | null) => (
    <button
      type="button"
      aria-label={name === "to" ? "To" : name === "token" ? "Token" : "Chain"}
      aria-expanded={open === name}
      disabled={saving}
      onClick={() => {
        setError(null);
        setOpen(open === name ? null : name);
      }}
      className={cn(
        "hover:bg-aomi-hover h-7 shrink-0 truncate rounded-[6px] px-2 text-[13px] outline-none focus-visible:ring-2",
        open === name && "bg-aomi-hover",
        !value && "text-aomi-muted",
      )}
    >
      {value ?? name}
    </button>
  );
  const slash = <span className="text-aomi-muted/60 px-0.5">/</span>;
  const chip = (label: string, selected: boolean, onClick: () => void) => (
    <button
      key={label}
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={cn(
        "rounded-full border px-2.5 py-1 text-[13px] transition-colors",
        selected
          ? "bg-aomi-fg text-aomi-bg border-transparent"
          : "border-aomi-border hover:bg-aomi-hover",
      )}
    >
      {label}
    </button>
  );

  return (
    <div data-rule-editor>
      <div className={ROW}>
        <div
          role="group"
          aria-label="New rule"
          className="border-aomi-border bg-aomi-raised focus-within:ring-aomi-ring/50 flex h-9 min-w-56 flex-1 items-center rounded-[10px] border px-1 focus-within:ring-2"
        >
          {segment("token", symbol)}
          {slash}
          <input
            ref={amountInput}
            inputMode="decimal"
            aria-label="Amount a day"
            placeholder="amount"
            disabled={saving}
            className="placeholder:text-aomi-muted h-7 w-20 min-w-0 rounded-[6px] bg-transparent px-2 text-[13px] tabular-nums outline-none"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              event.preventDefault();
              next({});
            }}
          />
          {slash}
          {segment(
            "chain",
            asset ? assetChain(asset, catalog ?? undefined) : null,
          )}
          {slash}
          {segment("to", to ? toLabel(to, catalog) : null)}
        </div>
        <AomiButton
          ref={addButton}
          variant="primary"
          size="sm"
          disabled={saving}
          onClick={add}
        >
          <Plus />
          Rule
        </AomiButton>
        {error ? (
          <p className="type-meta text-aomi-danger w-full">{error}</p>
        ) : null}
      </div>

      {open ? (
        <div
          role="group"
          aria-label={
            open === "token"
              ? "Token"
              : open === "chain"
                ? "Chain"
                : "To: a protocol, or an address"
          }
          className="border-aomi-border flex flex-col gap-2 border-t px-3.5 py-3"
        >
          {!catalog ? (
            <p className="type-meta text-aomi-muted flex items-center gap-2">
              {onRetry ? "Couldn’t load the list." : "Loading…"}
              {onRetry ? (
                <button
                  type="button"
                  onClick={onRetry}
                  className="hover:text-aomi-fg underline underline-offset-2"
                >
                  Try again
                </button>
              ) : null}
            </p>
          ) : open === "token" ? (
            <div className="flex flex-wrap gap-1.5">
              {symbols.map((entry) =>
                chip(entry, entry === symbol, () => pickToken(entry)),
              )}
            </div>
          ) : open === "chain" ? (
            symbol ? (
              <div className="flex flex-wrap gap-1.5">
                {onChains.map((entry) =>
                  chip(entry.chain, entry.asset === asset, () => {
                    // Apps differ per chain: a new chain drops the old one's.
                    const kept = entry.asset === asset ? to : null;
                    setAsset(entry.asset);
                    setTo(kept);
                    setError(null);
                    next({ asset: entry.asset, to: kept });
                  }),
                )}
              </div>
            ) : (
              <p className="type-meta text-aomi-muted">Pick the token first.</p>
            )
          ) : (
            <>
              {apps.length > 8 ? (
                <input
                  aria-label="Search protocols"
                  placeholder="Search protocols"
                  className={cn(INPUT, "w-full")}
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
              ) : null}
              <div className="flex flex-wrap gap-1.5">
                {chip("Any protocol", to?.kind === "any_protocol", () => {
                  setTo({ kind: "any_protocol" });
                  next({ to: { kind: "any_protocol" } });
                })}
                {shown.map((app) =>
                  chip(
                    app.label,
                    to?.kind === "protocol" && to.id === app.id,
                    () => {
                      setTo({ kind: "protocol", id: app.id });
                      next({ to: { kind: "protocol", id: app.id } });
                    },
                  ),
                )}
              </div>
              <div className="flex items-center gap-2">
                <input
                  aria-label="Send to address"
                  placeholder="Or paste a wallet address, for sends"
                  className={cn(INPUT, "min-w-0 flex-1")}
                  value={address}
                  onChange={(event) => setAddress(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter") return;
                    event.preventDefault();
                    applyAddress();
                  }}
                />
                <AomiButton size="sm" onClick={applyAddress}>
                  Use address
                </AomiButton>
              </div>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Who approves a change that gives the agent more: the owner, signed in to
 * Aomi, or one of the account's own wallets by its signature. The wallets
 * show only once "Selected wallet" is picked, and nothing is sent until Save.
 */
function RuleAuthority({
  admin,
  wallets,
  label,
  saving,
  onSave,
}: {
  admin: AomiRulesAdmin;
  /** The account's own wallets that may be selected. */
  wallets: readonly Extract<AomiRulesAdmin, { kind: "wallet" }>[];
  label: (wallet: Extract<AomiRulesAdmin, { kind: "wallet" }>) => string;
  saving: boolean;
  onSave: (admin: AomiRulesAdmin) => void;
}) {
  const [draft, setDraft] = useState<AomiRulesAdmin>(admin);
  const dirty = !sameAdmin(draft, admin);
  const id = (wallet: { family: string; address: string }) =>
    `${wallet.family}:${wallet.address}`;
  const option = (
    kind: AomiRulesAdmin["kind"],
    title: string,
    detail: string,
    onPick: () => void,
    disabled = false,
  ) => (
    <label className="type-control flex min-w-0 flex-1 cursor-pointer items-start gap-2.5">
      <input
        type="radio"
        name="rule-change-authority"
        className="mt-1"
        checked={draft.kind === kind}
        disabled={saving || disabled}
        onChange={onPick}
      />
      <span className="flex min-w-0 flex-col gap-0.5">
        {title}
        <span className="type-meta text-aomi-muted">{detail}</span>
      </span>
    </label>
  );
  return (
    <section
      aria-label="Rule change authority"
      data-rules-admin={admin.kind}
      className="flex flex-col gap-2"
    >
      <SectionHeader title="Rule change authority" />
      <ListGroup role="radiogroup" aria-label="Rule change authority">
        <div className={ROW}>
          {option(
            "aomi_managed",
            "Self-approval",
            "You approve changes in Aomi while signed in.",
            () => setDraft({ kind: "aomi_managed" }),
          )}
        </div>
        <div className={ROW}>
          {option(
            "wallet",
            "Selected wallet",
            draft.kind === "wallet"
              ? `Only a signature from ${label(draft)} changes this wallet’s rules.`
              : wallets.length
                ? "Only a signature from a wallet you pick changes this wallet’s rules."
                : "Link a wallet to your account to select it.",
            () => {
              const first = admin.kind === "wallet" ? admin : wallets[0];
              if (first) setDraft(first);
            },
            wallets.length === 0 && admin.kind !== "wallet",
          )}
          {draft.kind === "wallet" ? (
            <select
              aria-label="Wallet"
              disabled={saving}
              className={cn(INPUT, "max-w-full")}
              value={id(draft)}
              onChange={(event) => {
                const picked = wallets.find(
                  (wallet) => id(wallet) === event.target.value,
                );
                if (picked) setDraft(picked);
              }}
            >
              {(wallets.some((wallet) => sameAdmin(wallet, draft))
                ? wallets
                : [draft, ...wallets]
              ).map((wallet) => (
                <option key={id(wallet)} value={id(wallet)}>
                  {label(wallet)}
                </option>
              ))}
            </select>
          ) : null}
        </div>
        {dirty ? (
          <div className={cn(ROW, "justify-end")}>
            <AomiButton
              variant="ghost"
              size="sm"
              onClick={() => setDraft(admin)}
            >
              Cancel
            </AomiButton>
            <AomiButton
              variant="primary"
              size="sm"
              disabled={saving}
              onClick={() => onSave(draft)}
            >
              Save
            </AomiButton>
          </div>
        ) : null}
      </ListGroup>
    </section>
  );
}
