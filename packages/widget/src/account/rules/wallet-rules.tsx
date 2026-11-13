"use client";

import { cn } from "@/lib/cn";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Hand, Plus, X } from "lucide-react";
import {
  hasRules,
  type AomiRuleLimit,
  type AomiRuleSet,
  type AomiRuleUsage,
  type AomiRulesAdmin,
  type AomiRulesCatalog,
  type AomiRulesChangeRequest,
  type AomiWalletRules,
} from "@aomi-labs/client";
import { AomiButton, aomiButton } from "@/ui/aomi/button";
import { ListGroup, ListRow } from "@/ui/aomi/list-group";
import { SectionHeader } from "@/ui/aomi/section-header";
import { StatusPill } from "@/ui/aomi/status-pill";
import { Switch } from "@/ui/aomi/switch";
import { SheetAlert } from "@/wallet/picker/sheet-parts";
import { useAomiWalletKit } from "@/wallet/context";
import { useShellAomi } from "@/account/transport";
import { useRefreshWallets } from "@/account/agent-wallets/use-refresh-wallets";
import { OnchainRules } from "./onchain-rules";
import { RuleChangeCard, walletName } from "./rule-change-card";
import {
  assetAmount,
  assetChain,
  dateInputSeconds,
  dateInputValue,
  fromBaseUnits,
  ruleTemplates,
  rulesErrorCode,
  rulesFailure,
  sameAdmin,
  shortAsset,
  timeUntil,
  toBaseUnits,
  untilDate,
  usedPercent,
  withLimit,
} from "./rules-model";

const ROW =
  "flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-3.5 py-3";
const SENTENCE = "type-control min-w-0 flex-1";
const INPUT =
  "border-aomi-border bg-aomi-raised focus-visible:ring-aomi-ring/50 h-8 rounded-[8px] border px-2 text-[13px] outline-none focus-visible:ring-2";
const Strong = ({ children }: { children: ReactNode }) => (
  <strong className="font-semibold">{children}</strong>
);

/** `Jupiter`, `Kamino` in bold, comma separated. */
function Names({ names }: { names: readonly string[] }) {
  return (
    <>
      {names.map((name, index) => (
        <span key={name}>
          {index ? ", " : null}
          <Strong>{name}</Strong>
        </span>
      ))}
    </>
  );
}

const appLabel = (id: string, catalog: AomiRulesCatalog | null) =>
  catalog?.apps.find((app) => app.id === id)?.label ??
  `${id.charAt(0).toUpperCase()}${id.slice(1)}`;

/**
 * Wallet › Manage › Rules: what the agent may sign with this wallet, as
 * sentences with their controls. Each edit sends the full new set: one that
 * only takes power away saves at once, one that gives power opens the rule
 * change card and waits for the admin.
 */
export function WalletRules({
  wallet,
  delegate,
  filed,
}: {
  wallet: { id: string; name: string };
  /** The wallet's Solana address, where Swig can enforce the rules too. */
  delegate?: string;
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
  const [editing, setEditing] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [panel, setPanel] = useState<
    "apps" | "limit" | "admin" | "template" | null
  >(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Bumped after each answered save, so a draft that had to wait shows the
  // limit still in force.
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
      setPanel(null);
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
        rules?.enforced_by.length ? (
          <StatusPill>
            Enforced by{" "}
            {rules.enforced_by
              .map((name) => `${name.charAt(0).toUpperCase()}${name.slice(1)}`)
              .join(" + ")}
          </StatusPill>
        ) : (
          <StatusPill>Enforced by Aomi</StatusPill>
        )
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
  const {
    apps,
    limits,
    not_after: notAfter,
    owner_only: ownerOnly,
  } = rules.rules;
  const empty = rules.revision === 0 || !hasRules(rules.rules);
  const left = pending ? timeUntil(pending.expires_at) : null;
  const write = (next: Partial<AomiRuleSet>) =>
    void save({ rules: { ...rules.rules, ...next } });
  // An app list already keeps plain sends to the owner's wallets.
  const sendsHome = ownerOnly || apps !== null;
  const templates = (
    <AomiButton
      variant="ghost"
      size="sm"
      aria-expanded={panel === "template"}
      onClick={() => setPanel(panel === "template" ? null : "template")}
    >
      Use a template
    </AomiButton>
  );
  const templatePanel =
    panel === "template" ? (
      <TemplatePicker
        catalog={catalog}
        saving={saving}
        onCancel={() => setPanel(null)}
        onPick={(next) => {
          setEditing(true);
          void save({ rules: next });
        }}
      />
    ) : null;

  return (
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

      {empty && !editing ? (
        <div className="rounded-card border-aomi-border flex flex-wrap items-center justify-between gap-3 border border-dashed px-3.5 py-3">
          <p className="type-meta text-aomi-muted min-w-0 flex-1">
            No rules. This wallet follows only who approves trades.
          </p>
          <span className="flex items-center gap-1">
            {templates}
            <AomiButton size="sm" onClick={() => setEditing(true)}>
              Set rules
            </AomiButton>
          </span>
          {templatePanel ? (
            <div className="border-aomi-border w-full rounded-[10px] border">
              {templatePanel}
            </div>
          ) : null}
        </div>
      ) : (
        <>
          <ListGroup aria-busy={saving || undefined}>
            <div data-rule="apps">
              <div className={ROW}>
                <p className={cn(SENTENCE, !apps && "text-aomi-muted")}>
                  {apps?.length ? (
                    <>
                      Can use{" "}
                      <Names names={apps.map((id) => appLabel(id, catalog))} />
                    </>
                  ) : apps ? (
                    "Can use no app"
                  ) : (
                    "Can use any app"
                  )}
                </p>
                <AomiButton
                  size="sm"
                  aria-expanded={panel === "apps"}
                  onClick={() => setPanel(panel === "apps" ? null : "apps")}
                >
                  <Plus />
                  App
                </AomiButton>
              </div>
              {panel === "apps" ? (
                <AppPicker
                  catalog={catalog}
                  onRetry={catalogFailed ? loadCatalog : undefined}
                  selected={apps ?? []}
                  saving={saving}
                  onCancel={() => setPanel(null)}
                  onSave={(ids) => write({ apps: ids.length ? ids : null })}
                />
              ) : null}
            </div>

            {limits.map((cap) => (
              <CapRow
                key={`${cap.asset}:${cap.amount}:${epoch}`}
                cap={cap}
                token={catalog?.tokens.find(
                  (entry) => entry.asset === cap.asset,
                )}
                usage={rules.usage.find((entry) => entry.asset === cap.asset)}
                chain={assetChain(cap.asset, catalog ?? undefined)}
                saving={saving}
                onAmount={(amount) =>
                  write({ limits: withLimit(limits, cap.asset, amount) })
                }
              />
            ))}

            <div data-rule="not_after" className={ROW}>
              <p
                className={cn(SENTENCE, notAfter === null && "text-aomi-muted")}
              >
                {notAfter !== null ? (
                  <>
                    Until <Strong>{untilDate(notAfter)}</Strong>
                  </>
                ) : (
                  "No end date"
                )}
              </p>
              <span className="flex items-center gap-1">
                <input
                  type="date"
                  aria-label="End date"
                  disabled={saving}
                  className={INPUT}
                  value={notAfter !== null ? dateInputValue(notAfter) : ""}
                  onChange={(event) => {
                    const seconds = dateInputSeconds(event.target.value);
                    if (seconds === null || seconds === notAfter) return;
                    write({ not_after: seconds });
                  }}
                />
                {notAfter !== null ? (
                  <RemoveButton
                    label="Remove end date"
                    disabled={saving}
                    onClick={() => write({ not_after: null })}
                  />
                ) : null}
              </span>
            </div>

            <div data-rule="owner_only" className={ROW}>
              <p className={cn(SENTENCE, !sendsHome && "text-aomi-muted")}>
                {sendsHome ? (
                  <>
                    Sends only to <Strong>your wallets</Strong>
                  </>
                ) : (
                  "Sends to any address"
                )}
              </p>
              <span className="type-meta text-aomi-muted flex items-center gap-2">
                {ownerOnly ? "On" : apps !== null ? "With an app list" : "Off"}
                <Switch
                  aria-label="Sends only to your wallets"
                  checked={sendsHome}
                  disabled={saving || (!ownerOnly && apps !== null)}
                  onCheckedChange={(on) => write({ owner_only: on })}
                />
              </span>
            </div>

            <div data-rule="limits">
              <div className={ROW}>
                <p className={cn(SENTENCE, "text-aomi-muted")}>
                  {limits.length
                    ? "Tokens without a limit can't be spent"
                    : "No limits. Any token can be spent."}
                </p>
                <AomiButton
                  size="sm"
                  aria-expanded={panel === "limit"}
                  onClick={() => setPanel(panel === "limit" ? null : "limit")}
                >
                  <Plus />
                  Limit
                </AomiButton>
              </div>
              {panel === "limit" ? (
                <LimitPicker
                  catalog={catalog}
                  onRetry={catalogFailed ? loadCatalog : undefined}
                  taken={limits.map((limit) => limit.asset)}
                  saving={saving}
                  onCancel={() => setPanel(null)}
                  onAdd={(asset, amount) =>
                    write({ limits: withLimit(limits, asset, amount) })
                  }
                />
              ) : null}
            </div>
          </ListGroup>
          <p className="type-meta text-aomi-muted">
            {notice ? (
              <span role="status" className="text-aomi-fg font-medium">
                {notice}.{" "}
              </span>
            ) : null}
            Lower a number and it saves at once. Raise one and it needs
            approval. Limits reset at 00:00 UTC.
          </p>
          <div className="flex justify-end">{templates}</div>
          {templatePanel ? <ListGroup>{templatePanel}</ListGroup> : null}
        </>
      )}

      <ListGroup>
        <ListRow
          data-rules-admin={rules.admin.kind}
          title={
            <span className="flex flex-col">
              <span className="type-meta text-aomi-muted font-normal">
                Who can loosen rules
              </span>
              {rules.admin.kind === "wallet"
                ? walletName(rules.admin, kit)
                : "Aomi-managed"}
            </span>
          }
          description={
            <span className="whitespace-normal">
              {rules.admin.kind === "wallet"
                ? "Approve by signing. Aomi can't loosen anything."
                : "You approve with a click or a tap. Aomi holds the admin key."}
            </span>
          }
          trailing={
            <AomiButton
              size="sm"
              aria-expanded={panel === "admin"}
              onClick={() => setPanel(panel === "admin" ? null : "admin")}
            >
              Change
            </AomiButton>
          }
        />
        {panel === "admin" ? (
          <AdminPicker
            admin={rules.admin}
            options={[{ kind: "aomi_managed" }, ...rules.admin_wallets]}
            label={(option) =>
              option.kind === "wallet"
                ? walletName(option, kit)
                : "Aomi-managed"
            }
            saving={saving}
            onPick={(admin) => void save({ admin })}
          />
        ) : null}
      </ListGroup>
      {delegate ? (
        <OnchainRules delegate={delegate} revision={rules.revision} />
      ) : null}
    </section>
  );
}

function RemoveButton({
  label,
  disabled,
  onClick,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={aomiButton({ variant: "ghost", size: "icon-sm" })}
    >
      <X />
    </button>
  );
}

/** One limit: "Up to 200 USDC a day", its chain, today's use and the number. */
function CapRow({
  cap,
  token,
  usage,
  chain,
  saving,
  onAmount,
}: {
  cap: AomiRuleLimit;
  /** The catalog's entry for the asset, for a limit stored without its names. */
  token?: { symbol: string; decimals: number };
  usage?: AomiRuleUsage;
  chain: string;
  saving: boolean;
  /** The new base-unit amount; null removes the limit. */
  onAmount: (amount: string | null) => void;
}) {
  // A token neither the limit nor the catalog names is edited in raw units.
  const known = {
    asset: cap.asset,
    symbol: cap.symbol ?? token?.symbol,
    decimals: typeof cap.decimals === "number" ? cap.decimals : token?.decimals,
  };
  const decimals = known.decimals ?? 0;
  const name = known.symbol ?? shortAsset(cap.asset);
  const shown = fromBaseUnits(cap.amount, decimals);
  const [draft, setDraft] = useState(shown);
  const [invalid, setInvalid] = useState(false);
  const percent = usage ? usedPercent(usage.used, cap.amount) : 0;
  const commit = () => {
    const amount = toBaseUnits(draft, decimals);
    setInvalid(amount === null);
    if (amount === null || amount === cap.amount) return;
    onAmount(amount);
  };
  return (
    <div data-rule="limit" data-asset={cap.asset} className={ROW}>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <p className="type-control flex flex-wrap items-center gap-x-2 gap-y-1">
          <span>
            Up to <Strong>{assetAmount(cap.amount, known)} a day</Strong>
          </span>
          <StatusPill>{chain}</StatusPill>
        </p>
        {usage ? (
          <div className="flex items-center gap-2">
            <div
              role="progressbar"
              aria-label={`${name} used today`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={percent}
              className="bg-aomi-surface-2 h-1 min-w-0 flex-1 overflow-hidden rounded-full"
            >
              <div
                data-usage-tone={percent >= 80 ? "warning" : "neutral"}
                className={cn(
                  "h-full rounded-full",
                  percent >= 80 ? "bg-aomi-warning" : "bg-aomi-fg",
                )}
                style={{ width: `${percent}%` }}
              />
            </div>
            <span className="type-meta text-aomi-muted shrink-0 tabular-nums">
              {fromBaseUnits(usage.used, decimals)} used
            </span>
          </div>
        ) : null}
        {invalid ? (
          <span className="type-meta text-aomi-danger">
            Enter a valid amount.
          </span>
        ) : null}
      </div>
      <span className="flex items-center gap-1">
        <input
          inputMode="decimal"
          aria-label={`${name} daily limit`}
          aria-invalid={invalid || undefined}
          disabled={saving}
          className={cn(INPUT, "w-24 text-right tabular-nums")}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") commit();
          }}
        />
        <RemoveButton
          label={`Remove ${name} limit`}
          disabled={saving}
          onClick={() => onAmount(null)}
        />
      </span>
    </div>
  );
}

const PANEL = "border-aomi-border flex flex-col gap-2 border-t px-3.5 py-3";

function PanelActions({
  saving,
  disabled = false,
  label,
  onCancel,
  onSave,
}: {
  saving: boolean;
  disabled?: boolean;
  label: string;
  onCancel: () => void;
  onSave: () => void;
}) {
  return (
    <div className="flex justify-end gap-2">
      <AomiButton variant="ghost" size="sm" onClick={onCancel}>
        Cancel
      </AomiButton>
      <AomiButton
        variant="primary"
        size="sm"
        disabled={saving || disabled}
        onClick={onSave}
      >
        {label}
      </AomiButton>
    </div>
  );
}

/** A picker with nothing to list: empty, still loading, or failed with a retry. */
function CatalogState({
  empty,
  loading,
  failed,
  onRetry,
}: {
  empty: string | null;
  loading: string;
  failed: string;
  onRetry?: () => void;
}) {
  return (
    <p className="type-meta text-aomi-muted flex items-center gap-2">
      {empty ?? (onRetry ? failed : loading)}
      {!empty && onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="hover:text-aomi-fg underline underline-offset-2"
        >
          Try again
        </button>
      ) : null}
    </p>
  );
}

/** The catalog's apps as checkboxes; unchecking every one lifts the rule. */
function AppPicker({
  catalog,
  onRetry,
  selected,
  saving,
  onCancel,
  onSave,
}: {
  catalog: AomiRulesCatalog | null;
  /** Set when the catalog could not be read; reads it again. */
  onRetry?: () => void;
  selected: readonly string[];
  saving: boolean;
  onCancel: () => void;
  onSave: (ids: string[]) => void;
}) {
  const [picked, setPicked] = useState<readonly string[]>(selected);
  // An app the rule names but the catalog dropped can still be removed.
  const options = [
    ...(catalog?.apps ?? []),
    ...selected
      .filter((id) => !catalog?.apps.some((app) => app.id === id))
      .map((id) => ({ id, label: appLabel(id, catalog) })),
  ];
  return (
    <div role="group" aria-label="Allowed apps" className={PANEL}>
      {options.length ? (
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          {options.map((app) => (
            <label
              key={app.id}
              className="type-control flex cursor-pointer items-center gap-2"
            >
              <input
                type="checkbox"
                checked={picked.includes(app.id)}
                onChange={(event) =>
                  setPicked(
                    event.target.checked
                      ? [...picked, app.id]
                      : picked.filter((id) => id !== app.id),
                  )
                }
              />
              {app.label}
            </label>
          ))}
        </div>
      ) : (
        <CatalogState
          empty={catalog ? "No apps to pick from yet." : null}
          loading="Loading apps…"
          failed="Couldn’t load the apps."
          onRetry={onRetry}
        />
      )}
      <PanelActions
        saving={saving}
        label="Save apps"
        onCancel={onCancel}
        onSave={() => onSave([...picked].sort())}
      />
    </div>
  );
}

/** Ready-made rule sets; picking one sends it like any other edit. */
function TemplatePicker({
  catalog,
  saving,
  onCancel,
  onPick,
}: {
  catalog: AomiRulesCatalog | null;
  saving: boolean;
  onCancel: () => void;
  onPick: (rules: AomiRuleSet) => void;
}) {
  return (
    <div role="group" aria-label="Rule templates" className={PANEL}>
      {ruleTemplates(catalog).map((template) => (
        <div
          key={template.id}
          data-rule-template={template.id}
          className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1"
        >
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="type-control">{template.name}</span>
            <span className="type-meta text-aomi-muted">
              {template.summary}
            </span>
          </span>
          <AomiButton
            size="sm"
            disabled={saving}
            aria-label={`Use ${template.name}`}
            onClick={() => onPick(template.rules)}
          >
            Use
          </AomiButton>
        </div>
      ))}
      <p className="type-meta text-aomi-muted">
        A template replaces this wallet&rsquo;s rules. If it gives the agent
        more than it has now, it waits for approval.
      </p>
      <div className="flex justify-end">
        <AomiButton variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </AomiButton>
      </div>
    </div>
  );
}

/** Pick a catalog token and its daily amount in human units. */
function LimitPicker({
  catalog,
  onRetry,
  taken,
  saving,
  onCancel,
  onAdd,
}: {
  catalog: AomiRulesCatalog | null;
  onRetry?: () => void;
  taken: readonly string[];
  saving: boolean;
  onCancel: () => void;
  onAdd: (asset: string, amount: string) => void;
}) {
  const tokens = (catalog?.tokens ?? []).filter(
    (token) => !taken.includes(token.asset),
  );
  const [asset, setAsset] = useState("");
  const [draft, setDraft] = useState("");
  const token = tokens.find((entry) => entry.asset === asset) ?? tokens[0];
  const amount = token ? toBaseUnits(draft, token.decimals) : null;
  return (
    <div role="group" aria-label="New limit" className={PANEL}>
      {token ? (
        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="Token"
            className={cn(INPUT, "min-w-0 flex-1")}
            value={token.asset}
            onChange={(event) => setAsset(event.target.value)}
          >
            {tokens.map((entry) => (
              <option key={entry.asset} value={entry.asset}>
                {entry.symbol} on {entry.chain}
              </option>
            ))}
          </select>
          <input
            inputMode="decimal"
            aria-label="Daily amount"
            placeholder="0"
            className={cn(INPUT, "w-24 text-right tabular-nums")}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
          <span className="type-meta text-aomi-muted">a day</span>
        </div>
      ) : (
        <CatalogState
          empty={catalog ? "Every token here has a limit." : null}
          loading="Loading tokens…"
          failed="Couldn’t load the tokens."
          onRetry={onRetry}
        />
      )}
      <PanelActions
        saving={saving}
        disabled={!token || amount === null}
        label="Add limit"
        onCancel={onCancel}
        onSave={() => token && amount !== null && onAdd(token.asset, amount)}
      />
    </div>
  );
}

/** Aomi-managed, or one of the account's own wallets as the admin. */
function AdminPicker({
  admin,
  options,
  label,
  saving,
  onPick,
}: {
  admin: AomiRulesAdmin;
  options: readonly AomiRulesAdmin[];
  label: (option: AomiRulesAdmin) => string;
  saving: boolean;
  onPick: (admin: AomiRulesAdmin) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Who can loosen rules"
      className="flex flex-col gap-2 px-3.5 py-3"
    >
      {options.map((option) => {
        const current = sameAdmin(option, admin);
        return (
          <label
            key={
              option.kind === "wallet"
                ? `${option.family}:${option.address}`
                : option.kind
            }
            className="type-control flex cursor-pointer items-start gap-2"
          >
            <input
              type="radio"
              name="rules-admin"
              className="mt-1"
              checked={current}
              disabled={saving}
              onChange={() => {
                if (!current) onPick(option);
              }}
            />
            <span className="flex min-w-0 flex-col">
              {label(option)}
              <span className="type-meta text-aomi-muted">
                {option.kind === "wallet"
                  ? "Only this wallet's signature loosens the rules."
                  : "You approve with a click or a tap."}
              </span>
            </span>
          </label>
        );
      })}
      {options.length === 1 ? (
        <p className="type-meta text-aomi-muted">
          Link a wallet to your account to make it the admin.
        </p>
      ) : null}
    </div>
  );
}
