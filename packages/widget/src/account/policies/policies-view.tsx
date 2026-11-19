"use client";

import { cn } from "@/lib/cn";
import { useEffect, useState, type ComponentType, type ReactNode } from "react";
import {
  ArrowRight,
  Blocks,
  CalendarDays,
  Check,
  Coins,
  ExternalLink,
  Hand,
  Plus,
  X,
} from "lucide-react";
import { EthereumIcon, SolanaIcon } from "@/icons/chain-icons";
import { getAppIcon } from "@/icons/app-map";
import { getChainIcon } from "@/icons/chain-map";
import { BrandMark } from "@/account/account-management/controls";
import { AGENT_WALLET } from "@/account/account-management/wallet-model";
import { toBaseUnits, validAddress } from "@/account/rules/rules-model";
import { AomiButton, aomiButton } from "@/ui/aomi/button";
import { ListGroup } from "@/ui/aomi/list-group";
import { SectionHeader } from "@/ui/aomi/section-header";
import { Segmented } from "@/ui/aomi/segmented";
import { StatusPill } from "@/ui/aomi/status-pill";
import { Switch } from "@/ui/aomi/switch";
import { SheetAlert } from "@/wallet/picker/sheet-parts";
import {
  dayFromToday,
  periodLine,
  policyDay,
  policyToPhrase,
  sameAuthority,
  type Policy,
  type PolicyAuthority,
  type PolicyAuthorityWallet,
  type PolicyCatalog,
  type PolicyChain,
  type PolicyDraft,
  type PolicyProviders,
  type PolicyTo,
  type PolicyTokenChain,
  type RemovedPolicy,
  type WalletPolicies,
} from "./policy-model";

export const INPUT =
  "border-aomi-border bg-aomi-raised focus-visible:ring-aomi-ring/50 h-8 rounded-[8px] border px-2 text-[13px] outline-none focus-visible:ring-2";

/** Settings › Policies: waiting changes first, then one card per wallet. */
export function PoliciesView({
  title = true,
  changes,
  children,
}: {
  /** Off where the page around it already says "Policies". */
  title?: boolean;
  /** One card per waiting change. */
  changes?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div data-policies className="flex flex-col gap-5">
      <header className="flex flex-col gap-1 px-0.5">
        {title ? <h2 className="type-title">Policies</h2> : null}
        <p className="type-meta text-aomi-muted max-w-prose">
          Rules that secure your agent wallets. Aomi enforces every policy, and
          works with on-chain policy providers to enforce them on chain too.
        </p>
      </header>

      {changes ? (
        <section aria-label="Policy changes" className="flex flex-col gap-2">
          {changes}
        </section>
      ) : null}

      {children}
    </div>
  );
}

export type PolicyDeploy = {
  run: () => void;
  busy?: boolean;
  disabled?: boolean;
  hint?: string | null;
  error?: string | null;
};

export function WalletPolicyCard({
  wallet,
  catalog,
  providers = {},
  saving = false,
  notice,
  error,
  epoch = 0,
  onRetryCatalog,
  onLinkedOnly,
  onOnlyListed,
  onAdd,
  onRemove,
  onAuthority,
  deploy,
  takeOff,
  vaults,
}: {
  wallet: WalletPolicies;
  /** Null until read. */
  catalog: PolicyCatalog | null;
  providers?: PolicyProviders;
  saving?: boolean;
  /** e.g. `Saved`. */
  notice?: string | null;
  error?: string | null;
  /** A change closes the picker and resets drafts. */
  epoch?: number;
  onRetryCatalog?: () => void;
  onLinkedOnly: (on: boolean) => void;
  onOnlyListed: (on: boolean) => void;
  onAdd: (draft: PolicyDraft) => void;
  /** Removes it on every chain of its row. */
  onRemove: (policy: Policy) => void;
  onAuthority: (authority: PolicyAuthority) => void;
  deploy: (policy: Policy) => PolicyDeploy | undefined;
  takeOff?: (policy: RemovedPolicy) => PolicyDeploy | undefined;
  /** `VaultRow`s, after the policies. */
  vaults?: ReactNode;
}) {
  const [adding, setAdding] = useState(false);
  useEffect(() => setAdding(false), [epoch]);
  return (
    <section
      aria-label={`${wallet.name} policies`}
      data-wallet-policies={wallet.id}
    >
      <ListGroup aria-busy={saving || undefined}>
        <div className="flex flex-col gap-3 px-3.5 py-3">
          <div className="flex items-center justify-between gap-3">
            <h3 className="type-row flex min-w-0 flex-1 items-center gap-2">
              <BrandMark brand={AGENT_WALLET} box={20} size={16} />
              <span className="truncate">{wallet.name}</span>
            </h3>
            {notice ? (
              <span role="status" className="type-meta font-medium">
                {notice}.
              </span>
            ) : null}
            <AomiButton
              variant={adding ? "ghost" : "primary"}
              size="sm"
              aria-expanded={adding}
              onClick={() => setAdding((open) => !open)}
            >
              {adding ? <X /> : <Plus />}
              {adding ? "Cancel" : "Policy"}
            </AomiButton>
          </div>
          {wallet.stopped ? (
            <p className="type-meta text-aomi-muted flex items-start gap-1.5">
              <Hand className="mt-px size-3.5 shrink-0" />
              Stopped by the agent until 00:00 UTC
            </p>
          ) : null}
          {error ? <SheetAlert>{error}</SheetAlert> : null}
          <SwitchLine
            label="Only allow transfers to linked wallet"
            detail="Transfers go only to wallets linked to your account."
            checked={wallet.linkedOnly}
            disabled={saving}
            onChange={onLinkedOnly}
          />
          <SwitchLine
            label="Only allow policy-defined actions"
            detail={
              wallet.onlyListed
                ? "The agent can do only what a policy lists."
                : "The agent can do anything; a policy caps what it names. Not enforceable on chain."
            }
            checked={wallet.onlyListed}
            disabled={saving}
            onChange={onOnlyListed}
          />
        </div>

        {adding ? (
          <PolicyPicker
            catalog={catalog}
            providers={providers}
            onlyListed={wallet.onlyListed}
            saving={saving}
            onRetry={onRetryCatalog}
            onAdd={onAdd}
          />
        ) : null}

        {wallet.policies.map((policy) => (
          <PolicyRow
            key={policy.id}
            policy={policy}
            saving={saving}
            deploy={deploy(policy)}
            onRemove={() => onRemove(policy)}
          />
        ))}
        {wallet.policies.length === 0 && !adding ? (
          <p className="type-meta text-aomi-muted px-3.5 py-3">
            No policies yet.
          </p>
        ) : null}
        {(wallet.removed ?? []).map((policy) => (
          <RemovedPolicyRow
            key={policy.key}
            policy={policy}
            takeOff={takeOff?.(policy)}
          />
        ))}

        {vaults}

        <PolicyAuthorityPicker
          key={`${epoch}:${wallet.authority.kind}`}
          authority={wallet.authority}
          wallets={wallet.authorityWallets}
          saving={saving}
          onSave={onAuthority}
        />
      </ListGroup>
    </section>
  );
}

function SwitchLine({
  label,
  detail,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  detail: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className="type-control">{label}</p>
        <p className="type-meta text-aomi-muted">{detail}</p>
      </div>
      <Switch
        aria-label={label}
        checked={checked}
        disabled={disabled}
        onCheckedChange={onChange}
      />
    </div>
  );
}

type Glyph = ComponentType<{ className?: string }>;

export function chainGlyph(chain: PolicyChain): Glyph | undefined {
  const [namespace, reference] = chain.network.split(":");
  return namespace === "solana" ? SolanaIcon : getChainIcon(Number(reference));
}
export const tokenGlyph = (symbol: string): Glyph =>
  symbol === "SOL" ? SolanaIcon : symbol === "ETH" ? EthereumIcon : Coins;

export function ChainMark({ chain }: { chain: PolicyChain }) {
  const Icon = chainGlyph(chain);
  return Icon ? (
    <span
      role="img"
      aria-label={chain.label}
      title={chain.label}
      className="flex"
    >
      <Icon aria-hidden className="size-4 shrink-0" />
    </span>
  ) : (
    <StatusPill>{chain.label}</StatusPill>
  );
}

/** One policy row; an ended one stays listed, muted. */
export function PolicyRow({
  policy,
  saving = false,
  deploy,
  onRemove,
}: {
  policy: Policy;
  saving?: boolean;
  deploy?: PolicyDeploy;
  onRemove: () => void;
}) {
  const { enforcement } = policy;
  const where = policyToPhrase(policy.to);
  return (
    <div
      data-policy={policy.id}
      data-ended={policy.ended || undefined}
      className="flex flex-col gap-2 px-3.5 py-3"
    >
      <div className="flex items-center gap-2">
        <p
          className={cn(
            "type-control flex min-w-0 flex-1 flex-wrap items-center gap-x-1.5 gap-y-1",
            policy.ended && "text-aomi-muted opacity-60",
          )}
        >
          <span>
            {policy.blocked ? (
              <>
                No <strong className="font-semibold">{policy.symbol}</strong>
              </>
            ) : (
              <>
                Up to{" "}
                <strong className="font-semibold">
                  {policy.amount} {policy.symbol}
                </strong>
              </>
            )}{" "}
            {where}
          </span>
          {policy.chains.map((entry) => (
            <ChainMark key={entry.network} chain={entry} />
          ))}
        </p>
        <button
          type="button"
          aria-label={`Remove the policy for ${policy.symbol} ${where}`}
          disabled={saving}
          onClick={onRemove}
          className={aomiButton({ variant: "ghost", size: "icon-sm" })}
        >
          <X />
        </button>
      </div>
      <p
        className={cn(
          "type-meta text-aomi-muted",
          policy.ended && "opacity-60",
        )}
      >
        {periodLine(policy)}
      </p>
      <div
        className={cn(
          "type-meta flex flex-wrap items-center justify-between gap-2",
          policy.ended && "opacity-60",
        )}
      >
        <span className="text-aomi-muted flex flex-wrap items-center gap-1">
          Onchain Enforcement:
          {enforcement.name === null ? (
            <span className="text-aomi-fg font-medium">None</span>
          ) : enforcement.href ? (
            <a
              href={enforcement.href}
              target="_blank"
              rel="noreferrer"
              className="text-aomi-fg inline-flex items-center gap-0.5 font-medium underline-offset-2 hover:underline"
            >
              {enforcement.name}
              <ArrowRight className="size-3" />
            </a>
          ) : (
            <span className="text-aomi-fg font-medium">{enforcement.name}</span>
          )}
          {enforcement.left ? <span>{`· ${enforcement.left}`}</span> : null}
          {enforcement.chainEnd ? (
            <span>{`· chain ends ${policyDay(enforcement.chainEnd)}`}</span>
          ) : null}
          {enforcement.deploy && deploy ? (
            <AomiButton
              variant="primary"
              size="sm"
              disabled={deploy.disabled || deploy.busy}
              onClick={deploy.run}
            >
              {deploy.busy ? "Waiting for wallet…" : "Sign to deploy"}
            </AomiButton>
          ) : null}
        </span>
        {enforcement.warning ? (
          <StatusPill tone="warning">{enforcement.warning.label}</StatusPill>
        ) : enforcement.scope ? (
          <StatusPill>{enforcement.scope}</StatusPill>
        ) : enforcement.name !== null ||
          policy.blocked ||
          policy.ended ? null : (
          <StatusPill tone="warning">Total not enforced</StatusPill>
        )}
      </div>
      {enforcement.note ? (
        <p className="type-meta text-aomi-muted">{enforcement.note}</p>
      ) : null}
      {enforcement.deploy && deploy?.hint ? (
        <p className="type-meta text-aomi-muted">{deploy.hint}</p>
      ) : null}
      {enforcement.deploy && deploy?.error ? (
        <SheetAlert>{deploy.error}</SheetAlert>
      ) : null}
    </div>
  );
}

/**
 * A removed policy the chain still holds; its one action takes it off (or
 * sends the signed revocation). Gone once the chain lets go.
 */
export function RemovedPolicyRow({
  policy,
  takeOff,
}: {
  policy: RemovedPolicy;
  takeOff?: PolicyDeploy;
}) {
  const { enforcement } = policy;
  return (
    <div
      data-policy-removed={policy.id}
      className="flex flex-col gap-2 px-3.5 py-3"
    >
      <p className="type-control text-aomi-muted flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 opacity-60">
        <span>
          Removed · <strong className="font-semibold">{policy.symbol}</strong>
          {policy.to ? ` ${policyToPhrase(policy.to)}` : null}
        </span>
        <ChainMark chain={policy.chain} />
      </p>
      <div className="type-meta flex flex-wrap items-center justify-between gap-2">
        <span className="text-aomi-muted flex flex-wrap items-center gap-1">
          Onchain Enforcement:
          {enforcement.href ? (
            <a
              href={enforcement.href}
              target="_blank"
              rel="noreferrer"
              className="text-aomi-fg inline-flex items-center gap-0.5 font-medium underline-offset-2 hover:underline"
            >
              {enforcement.name}
              <ArrowRight className="size-3" />
            </a>
          ) : (
            <span className="text-aomi-fg font-medium">{enforcement.name}</span>
          )}
          {enforcement.left ? <span>{`· ${enforcement.left}`}</span> : null}
          {enforcement.deploy && takeOff ? (
            <AomiButton
              variant="primary"
              size="sm"
              disabled={takeOff.disabled || takeOff.busy}
              onClick={takeOff.run}
            >
              {takeOff.busy
                ? "Waiting for wallet…"
                : enforcement.send
                  ? "Send revocation"
                  : "Sign to take off"}
            </AomiButton>
          ) : null}
        </span>
        {enforcement.warning ? (
          <StatusPill tone="warning">{enforcement.warning.label}</StatusPill>
        ) : null}
      </div>
      {enforcement.note ? (
        <p className="type-meta text-aomi-muted">{enforcement.note}</p>
      ) : null}
      {enforcement.deploy && takeOff?.hint ? (
        <p className="type-meta text-aomi-muted">{takeOff.hint}</p>
      ) : null}
      {enforcement.deploy && takeOff?.error ? (
        <SheetAlert>{takeOff.error}</SheetAlert>
      ) : null}
    </div>
  );
}

type Segment = "token" | "chain" | "to";
const SEGMENT_LABEL: Record<Segment, string> = {
  token: "Token",
  chain: "Chain",
  to: "To",
};

const shortContract = (address: string) =>
  `${address.slice(0, 6)}…${address.slice(-4)}`;
const SESSIONS = [
  { label: "1 day", days: 1 },
  { label: "1 week", days: 7 },
  { label: "1 month", days: 30 },
] as const;

/** A picker choice, styled like the chat trace's chips. */
export function PickChip({
  icon: Icon,
  label,
  selected,
  onClick,
}: {
  icon?: Glyph;
  label: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={cn(
        "inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-[11px] tabular-nums leading-none outline-none transition-colors focus-visible:ring-2",
        selected
          ? "bg-aomi-fg text-aomi-bg border-transparent"
          : "border-aomi-border/80 bg-aomi-raised text-aomi-muted hover:border-aomi-muted/60 hover:text-aomi-fg",
      )}
    >
      {Icon ? (
        <Icon
          className={cn(
            "size-3.5 shrink-0",
            selected ? "text-aomi-bg" : "text-aomi-fg/80",
          )}
        />
      ) : null}
      <span className="truncate">{label}</span>
    </button>
  );
}

/**
 * The new-policy field, `token / amount / chain / to`; one policy per chain.
 * An optional period runs from save through the end of the picked day.
 */
export function PolicyPicker({
  catalog,
  providers,
  onlyListed,
  saving = false,
  onRetry,
  onAdd,
}: {
  catalog: PolicyCatalog | null;
  providers: PolicyProviders;
  /** Off, nothing can be held on chain: providers only allow what is listed. */
  onlyListed: boolean;
  saving?: boolean;
  onRetry?: () => void;
  onAdd: (draft: PolicyDraft) => void;
}) {
  const [symbol, setSymbol] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [chains, setChains] = useState<PolicyTokenChain[]>([]);
  const [to, setTo] = useState<PolicyTo | null>(null);
  const [session, setSession] = useState(false);
  const [until, setUntil] = useState("");
  const [custom, setCustom] = useState(false);
  const [address, setAddress] = useState("");
  const [open, setOpen] = useState<Segment | null>("token");
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);

  const tokens = catalog?.tokens ?? [];
  const token = tokens.find((entry) => entry.symbol === symbol);
  const picked = (entry: PolicyTokenChain) =>
    chains.some((held) => held.chain.network === entry.chain.network);
  const onEvery = (list: readonly PolicyTokenChain[]) =>
    (catalog?.apps ?? []).filter((app) =>
      list.every((entry) => app.chains.includes(entry.chain.network)),
    );
  const apps = onEvery(chains);
  const solana = (entry: PolicyTokenChain) =>
    entry.chain.network.startsWith("solana:");
  // One address works across chains only when they share a format.
  const oneFamily = chains.every(solana) || !chains.some(solana);
  const shownTokens = tokens.filter((entry) =>
    entry.symbol.toLowerCase().includes(query.trim().toLowerCase()),
  );
  const providerOf = (entry: PolicyTokenChain) =>
    onlyListed && to ? (providers[entry.chain.network]?.name ?? null) : null;
  // `total_and_period` leaves an app destination to Aomi; an address is held whole.
  const partial = [
    ...new Set(
      chains
        .filter(providerOf)
        .map((entry) => providers[entry.chain.network])
        .filter((held) => held?.holds === "total_and_period")
        .map((held) => held!.name),
    ),
  ];
  const destinationNote =
    to && to.kind !== "address" && partial.length
      ? ` ${partial.join(" and ")} holds the total and period on chain; Aomi alone checks the destination.`
      : "";

  const segment = (name: Segment, value: string | null) => (
    <button
      type="button"
      aria-label={SEGMENT_LABEL[name]}
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

  const toggleChain = (entry: PolicyTokenChain) => {
    const next = picked(entry)
      ? chains.filter((held) => held.chain.network !== entry.chain.network)
      : [...chains, entry];
    setChains(next);
    setError(null);
    // The destination must still exist on every chain that is left.
    if (
      to?.kind === "address" ||
      (to?.kind === "app" && !onEvery(next).some((app) => app.id === to.id))
    )
      setTo(null);
  };

  const add = () => {
    if (!symbol || chains.length === 0 || !to) {
      setError("Fill in the token, amount, chain and to.");
      setOpen(!symbol ? "token" : chains.length === 0 ? "chain" : "to");
      return;
    }
    if (chains.some((entry) => toBaseUnits(draft, entry.decimals) === null)) {
      setError("Enter an amount. 0 blocks the token there.");
      return;
    }
    if (session && !until) {
      setError("Pick how long the policy is active, or remove the period.");
      return;
    }
    setError(null);
    onAdd({
      symbol,
      amount: draft,
      chains,
      to,
      activeUntil: session ? until : null,
    });
  };

  const applyAddress = () => {
    const value = address.trim();
    if (chains.length === 0) {
      setError("Pick the token and chain first.");
      return;
    }
    if (!chains.every((entry) => validAddress(entry.asset, value))) {
      setError(
        `That isn’t an address on ${chains.map((entry) => entry.chain.label).join(", ")}.`,
      );
      return;
    }
    setError(null);
    setTo({ kind: "address", address: value });
    setOpen(null);
  };

  return (
    <div data-policy-picker className="flex flex-col gap-2.5 px-3.5 py-3">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <div
          role="group"
          aria-label="New policy"
          className="border-aomi-border bg-aomi-bg focus-within:ring-aomi-ring/50 flex h-9 min-w-56 flex-1 items-center overflow-x-auto rounded-[10px] border px-1 focus-within:ring-2"
        >
          {segment("token", symbol)}
          {slash}
          <input
            inputMode="decimal"
            aria-label="Total amount"
            placeholder="amount"
            disabled={saving}
            className="placeholder:text-aomi-muted h-7 w-20 min-w-0 rounded-[6px] bg-transparent px-2 text-[13px] tabular-nums outline-none"
            value={draft}
            onChange={(event) =>
              setDraft(
                event.target.value
                  .replace(/[^0-9.]/g, "")
                  .replace(/(\..*)\./g, "$1"),
              )
            }
          />
          {slash}
          {segment(
            "chain",
            chains.length
              ? chains.map((entry) => entry.chain.label).join(", ")
              : null,
          )}
          {slash}
          {segment(
            "to",
            to
              ? to.kind === "any_app"
                ? "Any protocol"
                : to.kind === "app"
                  ? to.label
                  : shortContract(to.address)
              : null,
          )}
        </div>
        <AomiButton variant="primary" size="sm" disabled={saving} onClick={add}>
          <Plus />
          Policy
        </AomiButton>
        {error ? (
          <p className="type-meta text-aomi-danger w-full">{error}</p>
        ) : null}
      </div>

      {open && !catalog ? (
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
        <>
          <input
            aria-label="Search tokens"
            placeholder="Search tokens"
            className={cn(INPUT, "w-full")}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <div className="flex flex-wrap gap-1.5">
            {shownTokens.map((entry) => (
              <PickChip
                key={entry.symbol}
                icon={tokenGlyph(entry.symbol)}
                label={entry.symbol}
                selected={entry.symbol === symbol}
                onClick={() => {
                  setSymbol(entry.symbol);
                  setError(null);
                  const only =
                    entry.chains.length === 1 ? [...entry.chains] : [];
                  setChains(only);
                  setTo(null);
                  setOpen(only.length ? "to" : "chain");
                }}
              />
            ))}
          </div>
        </>
      ) : open === "chain" ? (
        token ? (
          <div className="flex flex-wrap items-center gap-1.5">
            {token.chains.map((entry) => (
              <PickChip
                key={entry.chain.network}
                icon={chainGlyph(entry.chain)}
                label={entry.chain.label}
                selected={picked(entry)}
                onClick={() => toggleChain(entry)}
              />
            ))}
            <span className="type-meta text-aomi-muted">Pick one or more.</span>
            <span className="flex-1" />
            <AomiButton
              variant="ghost"
              size="sm"
              disabled={chains.length === 0}
              onClick={() => setOpen("to")}
            >
              Next
              <ArrowRight />
            </AomiButton>
          </div>
        ) : (
          <p className="type-meta text-aomi-muted">Pick the token first.</p>
        )
      ) : open === "to" ? (
        <>
          <div
            role="group"
            aria-label="To: a protocol, or an address"
            className="flex flex-wrap gap-1.5"
          >
            <PickChip
              icon={Blocks}
              label="Any protocol"
              selected={to?.kind === "any_app"}
              onClick={() => {
                setTo({ kind: "any_app" });
                setError(null);
                setOpen(null);
              }}
            />
            {apps.map((app) => (
              <PickChip
                key={app.id}
                icon={getAppIcon(app.id) ?? Blocks}
                label={app.label}
                selected={to?.kind === "app" && to.id === app.id}
                onClick={() => {
                  setTo({ kind: "app", id: app.id, label: app.label });
                  setError(null);
                  setOpen(null);
                }}
              />
            ))}
          </div>
          {oneFamily ? (
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
          ) : (
            <p className="type-meta text-aomi-muted">
              One address can’t be used across these chains.
            </p>
          )}
        </>
      ) : null}

      {symbol && chains.length > 0 ? (
        <ul className="type-meta text-aomi-muted flex flex-wrap gap-x-4 gap-y-1">
          {chains.map((entry) => {
            const Icon = chainGlyph(entry.chain);
            return (
              <li
                key={entry.chain.network}
                className="flex items-center gap-1.5"
              >
                {Icon ? <Icon className="size-3.5 shrink-0" /> : null}
                {symbol} on {entry.chain.label}
                {entry.address && entry.explorer ? (
                  <a
                    href={entry.explorer}
                    target="_blank"
                    rel="noreferrer"
                    className="type-address hover:text-aomi-fg inline-flex items-center gap-1 underline-offset-2 hover:underline"
                  >
                    {shortContract(entry.address)}
                    <ExternalLink aria-hidden className="size-3" />
                  </a>
                ) : entry.address ? (
                  <span className="type-address">
                    {shortContract(entry.address)}
                  </span>
                ) : (
                  <span>· native</span>
                )}
              </li>
            );
          })}
        </ul>
      ) : null}

      {session ? (
        <div
          data-policy-session
          className="flex flex-wrap items-center gap-x-2 gap-y-2"
        >
          <span className="type-control">Active period</span>
          <span className="type-meta text-aomi-muted">
            Starts when saved, runs
          </span>
          {SESSIONS.map((entry) => (
            <PickChip
              key={entry.label}
              label={entry.label}
              selected={!custom && until === dayFromToday(entry.days)}
              onClick={() => {
                setCustom(false);
                setError(null);
                setUntil(dayFromToday(entry.days));
              }}
            />
          ))}
          <PickChip
            icon={CalendarDays}
            label="Pick a date"
            selected={custom}
            onClick={() => setCustom(true)}
          />
          {custom ? (
            <input
              type="date"
              aria-label="Active through"
              className={INPUT}
              value={until}
              min={dayFromToday(0)}
              onChange={(event) => {
                setError(null);
                setUntil(event.target.value);
              }}
            />
          ) : null}
          {until ? (
            <span className="type-meta text-aomi-muted">
              through {policyDay(until)}
            </span>
          ) : null}
          <span className="flex-1" />
          <AomiButton
            variant="ghost"
            size="sm"
            onClick={() => {
              setSession(false);
              setCustom(false);
              setUntil("");
            }}
          >
            <X />
            Remove period
          </AomiButton>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <AomiButton
            variant="primary"
            size="sm"
            onClick={() => {
              setSession(true);
              setOpen(null);
            }}
          >
            Set active period
          </AomiButton>
          <span className="type-meta text-aomi-muted">
            Without one the policy is always on.
          </span>
        </div>
      )}

      {chains.length > 0 && to ? (
        <p className="type-meta text-aomi-muted">
          Onchain Enforcement:{" "}
          {chains.map((entry, index) => (
            <span key={entry.chain.network}>
              {index ? ", " : null}
              {chains.length > 1 ? `${entry.chain.label} ` : null}
              <span className="text-aomi-fg font-medium">
                {providerOf(entry) ?? "None"}
              </span>
            </span>
          ))}
          {chains.some(providerOf)
            ? `. It starts when you sign its deployment.${destinationNote}`
            : onlyListed
              ? ". Aomi checks the destination and period; the total isn’t enforced."
              : ". With the switch off nothing goes on chain: a block works, a total isn’t enforced."}
        </p>
      ) : null}
    </div>
  );
}

const walletKey = (wallet: { family: string; address: string }) =>
  `${wallet.family}:${wallet.address}`;

/**
 * Who approves loosening changes: the signed-in owner, or one wallet's
 * signature. A new authority is itself a change that waits for approval.
 */
export function PolicyAuthorityPicker({
  authority,
  wallets,
  saving = false,
  onSave,
}: {
  authority: PolicyAuthority;
  wallets: readonly PolicyAuthorityWallet[];
  saving?: boolean;
  onSave: (next: PolicyAuthority) => void;
}) {
  const [draft, setDraft] = useState<PolicyAuthority>(authority);
  const dirty = !sameAuthority(draft, authority);
  return (
    <div
      data-policy-authority={authority.kind}
      className="flex flex-col gap-2.5 px-3.5 py-3"
    >
      <SectionHeader
        title="Policy change authority"
        className="px-0"
        action={
          <Segmented
            label="Policy change authority"
            size="sm"
            value={draft.kind}
            disabled={saving}
            onChange={(kind) => {
              if (kind === "aomi") return setDraft({ kind: "aomi" });
              const first =
                authority.kind === "wallet" ? authority : wallets[0];
              if (first)
                setDraft({
                  kind: "wallet",
                  family: first.family,
                  address: first.address,
                });
            }}
            options={[
              { value: "aomi", label: "Self-approval" },
              {
                value: "wallet",
                label: "Selected wallet",
                disabled: wallets.length === 0 && authority.kind !== "wallet",
              },
            ]}
          />
        }
      />
      {draft.kind === "aomi" ? (
        <p className="type-meta text-aomi-muted">
          You approve changes in Aomi while signed in.
        </p>
      ) : (
        <>
          <div
            role="radiogroup"
            aria-label="Wallet that approves changes"
            className="border-aomi-border bg-aomi-bg divide-aomi-border rounded-control flex flex-col divide-y overflow-hidden border"
          >
            {wallets.map((wallet) => {
              const selected = sameAuthority(draft, {
                kind: "wallet",
                family: wallet.family,
                address: wallet.address,
              });
              return (
                <button
                  key={walletKey(wallet)}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  disabled={saving}
                  onClick={() =>
                    setDraft({
                      kind: "wallet",
                      family: wallet.family,
                      address: wallet.address,
                    })
                  }
                  className={cn(
                    "hover:bg-aomi-hover flex items-center gap-3 px-3 py-2.5 text-left outline-none transition-colors focus-visible:ring-2",
                    selected && "bg-aomi-hover",
                  )}
                >
                  <BrandMark brand={wallet.brand} box={28} size={18} />
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="type-row capitalize">{wallet.brand}</span>
                    <span className="type-address text-aomi-muted truncate">
                      {[
                        shortContract(wallet.address),
                        wallet.login,
                        wallet.family,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </span>
                  {selected ? (
                    <Check aria-hidden className="size-4 shrink-0" />
                  ) : null}
                </button>
              );
            })}
          </div>
          <p className="type-meta text-aomi-muted">
            Only a signed-in wallet can change policy. Sign in with Privy to use
            a Privy wallet.
          </p>
        </>
      )}
      {dirty ? (
        <div className="flex items-center justify-end gap-2">
          <AomiButton
            variant="ghost"
            size="sm"
            onClick={() => setDraft(authority)}
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
    </div>
  );
}

/** Connection and policy counts, each linking to its tab. */
export function WalletPolicySummary({
  connections,
  policies,
  onConnections,
  onPolicies,
}: {
  connections: number;
  /** Null while the wallet's policies are being read. */
  policies: number | null;
  onConnections: () => void;
  onPolicies: () => void;
}) {
  const row = (
    title: string,
    count: number | null,
    detail: string,
    action: string,
    onClick: () => void,
  ) => (
    <div className="flex flex-col gap-1 px-3.5 py-3">
      <div className="flex items-center justify-between gap-3">
        <p className="type-control flex items-baseline gap-2">
          {title}
          <span className="type-meta text-aomi-muted tabular-nums">
            {count}
          </span>
        </p>
        <button
          type="button"
          onClick={onClick}
          className="type-meta text-aomi-fg inline-flex items-center gap-1 font-medium underline-offset-2 hover:underline"
        >
          {action}
          <ArrowRight className="size-3" />
        </button>
      </div>
      <p className="type-meta text-aomi-muted">{detail}</p>
    </div>
  );
  return (
    <ListGroup data-wallet-policy-summary>
      {row(
        "Connections",
        connections,
        "Agent connections with access to this wallet: MCP, CLI, Telegram and web. It is always reachable from aomi.chat.",
        "Manage in Connections",
        onConnections,
      )}
      {row(
        "Policies",
        policies,
        "Spending limits and where money may go. Managed by Aomi, optionally enforced on chain.",
        "Manage in Policies",
        onPolicies,
      )}
    </ListGroup>
  );
}
