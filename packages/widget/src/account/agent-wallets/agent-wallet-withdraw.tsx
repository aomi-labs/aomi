"use client";

import { useEffect, useReducer, useRef, useState, type ReactNode } from "react";
import {
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  Fuel,
  Plus,
  ShieldCheck,
} from "lucide-react";
import {
  AomiCommits,
  shortAddress,
  type AomiAgentWallet,
  type AomiAgentWalletBalances,
  type AomiAgentWalletNetwork,
  type CommitHandle,
} from "@aomi-labs/client";
import { cn } from "@aomi-labs/react";
import { AomiSheet } from "@/ui/aomi/aomi-sheet";
import { AomiButton } from "@/ui/aomi/button";
import { ListGroup, ListRow } from "@/ui/aomi/list-group";
import { LoadingPane } from "@/ui/aomi/loading-pane";
import { Segmented } from "@/ui/aomi/segmented";
import {
  SheetAlert,
  SheetFootnote,
  SheetHeader,
  WaitingButton,
} from "@/wallet/picker/sheet-parts";
import type { WalletFamily } from "@/wallet/types";
import type { WalletRow } from "@/wallet/composer/wallet-state";
import { useShellTransport } from "@/account/transport";
import { BrandMark } from "@/account/account-management/controls";
import {
  appName,
  plural,
  rowTitle,
} from "@/account/account-management/wallet-model";
import { familyName } from "./agent-wallet-model";
import { useRefreshWallets } from "./use-refresh-wallets";

/** One asset line in step 2; `balance` is unknown for a token added by address. */
type AssetPick = {
  token: string;
  symbol: string;
  balance?: string;
  amount: string;
  max: boolean;
  checked: boolean;
};

type Step =
  | { step: "network" }
  | { step: "assets"; network: AomiAgentWalletNetwork; picks: AssetPick[] }
  | { step: "destination"; network: AomiAgentWalletNetwork; picks: AssetPick[] }
  | { step: "sent"; network: AomiAgentWalletNetwork; handle: CommitHandle };

const DECIMAL = /^(?:\d+\.?\d*|\.\d+)$/;
const ADDRESS: Record<WalletFamily, RegExp> = {
  evm: /^0x[0-9a-fA-F]{40}$/,
  svm: /^[1-9A-HJ-NP-Za-km-z]{32,44}$/,
};

const usd = (value: string | null) =>
  value === null ? undefined : `$${Number(value).toFixed(2)}`;

/** Why a withdraw did not go out, in words the owner can act on. */
function withdrawError(cause: unknown): string {
  const code = (cause as { code?: string } | null)?.code;
  if (code === "insufficient_balance")
    return "Nothing was sent. The wallet holds less than that now.";
  if (code === "invalid_amount")
    return "Nothing was sent. Check the amounts and try again.";
  return "Nothing was sent. Try again.";
}

/** Ticked, with Max or a positive amount no larger than what it holds. */
function pickError(pick: AssetPick): boolean {
  if (!pick.checked || pick.max) return false;
  if (!DECIMAL.test(pick.amount) || Number(pick.amount) <= 0) return true;
  return (
    pick.balance !== undefined && Number(pick.amount) > Number(pick.balance)
  );
}

/**
 * Withdraw in one sheet: a network (with its balances), the assets and how
 * much of each, then where to. It works while the wallet is paused or
 * archived; the resulting commit is approved here at once.
 */
export function AgentWalletWithdraw({
  wallet,
  rows,
  onClose,
}: {
  wallet: AomiAgentWallet;
  /** The wallet kit's rows; your own sign-in wallets are offered first. */
  rows: readonly WalletRow[];
  onClose: () => void;
}) {
  const { client } = useShellTransport();
  const families = wallet.addresses.map((address) => address.family);
  const [family, setFamily] = useState<WalletFamily>(families[0] ?? "evm");
  const [balances, setBalances] = useState<
    Partial<Record<WalletFamily, AomiAgentWalletBalances | "error">>
  >({});
  const [state, setState] = useState<Step>({ step: "network" });
  const loaded = balances[family];

  useEffect(() => {
    if (balances[family]) return;
    const controller = new AbortController();
    client.account.wallets
      .agentWalletBalances(wallet.id, family, { signal: controller.signal })
      .then(
        (result) => setBalances((all) => ({ ...all, [family]: result })),
        () =>
          !controller.signal.aborted &&
          setBalances((all) => ({ ...all, [family]: "error" })),
      );
    return () => controller.abort();
  }, [balances, client, family, wallet.id]);

  const back =
    state.step === "assets"
      ? () => setState({ step: "network" })
      : state.step === "destination"
        ? () => setState({ ...state, step: "assets" })
        : undefined;
  const header = (title: string, description: string) => (
    <SheetHeader
      title={title}
      description={description}
      onClose={onClose}
      leading={
        back ? (
          <button
            type="button"
            aria-label="Back"
            onClick={back}
            className="text-aomi-muted hover:bg-aomi-hover hover:text-aomi-fg -ml-1 flex size-7 shrink-0 items-center justify-center rounded-full transition-colors"
          >
            <ChevronLeft className="size-4" />
          </button>
        ) : undefined
      }
    />
  );

  return (
    <AomiSheet onClose={onClose}>
      {state.step === "network" ? (
        <>
          {header(
            `Withdraw from "${wallet.name}"`,
            "Step 1 of 3 · pick a network",
          )}
          <div className="flex min-h-0 flex-col gap-4 overflow-y-auto px-5 pb-5">
            {families.length > 1 ? (
              <Segmented
                label="Address family"
                className="self-center"
                value={family}
                onChange={setFamily}
                options={families.map((value) => ({
                  value,
                  label: familyName(value),
                }))}
              />
            ) : null}
            {!loaded ? (
              <LoadingPane label="Loading balances" />
            ) : loaded === "error" ? (
              <SheetAlert>Couldn’t load the balances. Try again.</SheetAlert>
            ) : (
              <Networks
                balances={loaded}
                onPick={(network) =>
                  setState({
                    step: "assets",
                    network,
                    picks: network.assets.map((asset) => ({
                      token: asset.token,
                      symbol: asset.symbol,
                      balance: asset.amount,
                      amount: "",
                      max: false,
                      checked: false,
                    })),
                  })
                }
              />
            )}
            <p className="type-meta text-aomi-muted flex items-start gap-1.5">
              <ShieldCheck className="mt-px size-3.5 shrink-0" />
              Works even while the wallet is paused or archived.
            </p>
          </div>
        </>
      ) : state.step === "assets" ? (
        <>
          {header(`${state.network.name} · pick assets`, "Step 2 of 3")}
          <Assets
            family={family}
            picks={state.picks}
            onChange={(picks) => setState({ ...state, picks })}
            onNext={() => setState({ ...state, step: "destination" })}
          />
        </>
      ) : state.step === "destination" ? (
        <>
          {header("Send to", "Step 3 of 3")}
          <Destination
            wallet={wallet}
            family={family}
            network={state.network}
            picks={state.picks}
            rows={rows}
            onSent={(handle) =>
              setState({ step: "sent", network: state.network, handle })
            }
          />
        </>
      ) : (
        <Sent handle={state.handle} network={state.network} onClose={onClose} />
      )}
    </AomiSheet>
  );
}

function Networks({
  balances,
  onPick,
}: {
  balances: AomiAgentWalletBalances;
  onPick: (network: AomiAgentWalletNetwork) => void;
}) {
  const funded = balances.networks.filter(
    (network) => !network.error && network.assets.length > 0,
  );
  const rest = balances.networks.filter((network) => !funded.includes(network));
  return (
    <ListGroup>
      {funded.map((network) => (
        <button
          key={network.chain_id}
          type="button"
          onClick={() => onPick(network)}
          className="hover:bg-aomi-hover block w-full text-left outline-none transition-colors"
        >
          <ListRow
            title={network.name}
            description={plural(network.assets.length, "asset")}
            trailing={
              <>
                <span className="type-meta text-aomi-muted tabular-nums">
                  {usd(network.usd_total)}
                </span>
                <ChevronRight className="text-aomi-muted size-4" />
              </>
            }
          />
        </button>
      ))}
      {rest.length ? (
        <ListRow
          className="opacity-50"
          title={
            funded.length
              ? plural(rest.length, "more network")
              : "Nothing to withdraw"
          }
          description={rest
            .map((network) =>
              network.error ? `${network.name} (couldn’t read)` : network.name,
            )
            .join(", ")
            .concat(" · empty")}
        />
      ) : null}
    </ListGroup>
  );
}

function Assets({
  family,
  picks,
  onChange,
  onNext,
}: {
  family: WalletFamily;
  picks: AssetPick[];
  onChange: (picks: AssetPick[]) => void;
  onNext: () => void;
}) {
  const [adding, setAdding] = useState<string | null>(null);
  const set = (index: number, change: Partial<AssetPick>) =>
    onChange(
      picks.map((pick, at) => (at === index ? { ...pick, ...change } : pick)),
    );
  const nativeMax = picks.some(
    (pick) => pick.checked && pick.max && pick.token === "native",
  );
  const ready = picks.some((pick) => pick.checked) && !picks.some(pickError);
  const tokenKind = family === "evm" ? "ERC-20" : "SPL";
  const addToken = () => {
    const token = adding?.trim() ?? "";
    if (!ADDRESS[family].test(token)) return;
    onChange([
      ...picks,
      {
        token,
        symbol: shortAddress(token),
        amount: "",
        max: false,
        checked: true,
      },
    ]);
    setAdding(null);
  };
  return (
    <div className="flex min-h-0 flex-col gap-4 overflow-y-auto px-5 pb-5">
      <ListGroup>
        {picks.map((pick, index) => (
          <div
            key={pick.token}
            data-asset={pick.token}
            className="flex min-h-14 items-center gap-3 px-3.5 py-2.5"
          >
            <input
              type="checkbox"
              aria-label={`Withdraw ${pick.symbol}`}
              checked={pick.checked}
              onChange={(event) =>
                set(index, { checked: event.target.checked })
              }
              className="accent-aomi-fg size-4 shrink-0"
            />
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="type-row truncate">{pick.symbol}</span>
              <span className="type-meta text-aomi-muted truncate">
                {pick.token === "native" ? "native" : tokenKind}
                {pick.balance !== undefined ? ` · ${pick.balance}` : ""}
              </span>
            </span>
            <input
              inputMode="decimal"
              aria-label={`${pick.symbol} amount`}
              aria-invalid={pickError(pick) || undefined}
              disabled={!pick.checked}
              value={pick.max ? "Max" : pick.amount}
              placeholder="0.0"
              onChange={(event) =>
                set(index, { amount: event.target.value.trim(), max: false })
              }
              className={cn(
                "border-aomi-border bg-aomi-bg type-address rounded-control h-7 w-24 shrink-0 border px-2 text-right outline-none disabled:opacity-50",
                pickError(pick) && "border-aomi-danger",
              )}
            />
            <button
              type="button"
              disabled={!pick.checked}
              onClick={() => set(index, { max: true, amount: "" })}
              className="type-meta text-aomi-accent-strong font-medium disabled:opacity-50"
            >
              Max
            </button>
          </div>
        ))}
      </ListGroup>
      {nativeMax ? (
        <p className="type-meta text-aomi-muted flex items-start gap-1.5">
          <Fuel className="mt-px size-3.5 shrink-0" />
          Max keeps enough of the native token for this withdrawal’s gas.
        </p>
      ) : null}
      <ListGroup>
        {adding === null ? (
          <button
            type="button"
            onClick={() => setAdding("")}
            className="hover:bg-aomi-hover block w-full text-left outline-none transition-colors"
          >
            <ListRow
              title="Add a token by address"
              description="For tokens we don’t list yet"
              trailing={<Plus className="text-aomi-muted size-4" />}
            />
          </button>
        ) : (
          <div className="flex items-center gap-2 px-3.5 py-2.5">
            <input
              autoFocus
              value={adding}
              aria-label="Token address"
              placeholder={family === "evm" ? "0x…" : "Mint address"}
              onChange={(event) => setAdding(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") addToken();
                if (event.key === "Escape") setAdding(null);
              }}
              className="border-aomi-border bg-aomi-bg type-address rounded-control h-8 min-w-0 flex-1 border px-2 outline-none"
            />
            <AomiButton
              size="sm"
              disabled={!ADDRESS[family].test(adding.trim())}
              onClick={addToken}
            >
              Add
            </AomiButton>
          </div>
        )}
      </ListGroup>
      <AomiButton
        variant="primary"
        className="h-10 w-full"
        disabled={!ready}
        onClick={onNext}
      >
        Next
      </AomiButton>
    </div>
  );
}

function Destination({
  wallet,
  family,
  network,
  picks,
  rows,
  onSent,
}: {
  wallet: AomiAgentWallet;
  family: WalletFamily;
  network: AomiAgentWalletNetwork;
  picks: AssetPick[];
  rows: readonly WalletRow[];
  onSent: (handle: CommitHandle) => void;
}) {
  const { client } = useShellTransport();
  const refresh = useRefreshWallets();
  const own = rows.filter(
    (row) => row.linked && row.kind !== "agent" && row.family === family,
  );
  const [to, setTo] = useState<string | null>(own[0]?.address ?? null);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Once the withdraw exists, every retry approves or re-reads this one ref;
  // nothing ever creates a second withdrawal.
  const [ref, setRef] = useState<string | null>(null);
  const handle = useRef<CommitHandle | null>(null);
  useEffect(() => () => handle.current?.close(), []);
  const chosen = picks.filter((pick) => pick.checked);
  const destination = to ?? typed.trim();
  const valid = ADDRESS[family].test(destination);

  const create = async () => {
    try {
      const created = await client.account.wallets.withdrawAgentWallet(
        wallet.id,
        {
          family,
          ...(typeof network.chain_id === "number"
            ? { chain_id: network.chain_id }
            : {}),
          to: destination,
          assets: chosen.map((pick) => ({
            token: pick.token,
            amount: pick.max ? "max" : pick.amount,
          })),
        },
      );
      setRef(created.ref);
      return created.ref;
    } catch (cause) {
      // Refused before any commit existed: nothing was sent.
      setError(withdrawError(cause));
      return null;
    }
  };

  /** Approve `id` if it still waits; otherwise show where it is. */
  const settle = async (id: string) => {
    try {
      handle.current ??= await new AomiCommits(client).get(id);
      const current = handle.current;
      if (current.view.state === "awaiting_approval") await current.approve();
      handle.current = null;
      void refresh();
      onSent(current);
    } catch {
      // The approve or the read may have landed anyway: never claim nothing
      // was sent; Try again re-reads and re-approves this same withdrawal.
      const state = await handle.current
        ?.refresh()
        .then((view) => view.state as string)
        .catch(() => undefined);
      if (state && state !== "awaiting_approval" && handle.current) {
        const current = handle.current;
        handle.current = null;
        onSent(current);
        return;
      }
      setError(
        state === "awaiting_approval"
          ? "The withdrawal is waiting for your approval. Try again to approve it."
          : "Couldn’t confirm the withdrawal. Try again to check it; it won’t be sent twice.",
      );
    }
  };

  const withdraw = async () => {
    setBusy(true);
    setError(null);
    const id = ref ?? (await create());
    if (id) await settle(id);
    setBusy(false);
  };

  return (
    <div className="flex min-h-0 flex-col gap-4 overflow-y-auto px-5 pb-5">
      {/* Fixed once the withdrawal exists. */}
      <fieldset disabled={ref !== null} className="contents">
        <ListGroup role="radiogroup" aria-label="Destination">
          {own.map((row) => (
            <Choice
              key={row.key}
              checked={to === row.address}
              onSelect={() => setTo(row.address)}
              leading={<BrandMark brand={appName(row)} size={15} box={28} />}
              title={rowTitle(row).title}
              description={`${shortAddress(row.address)} · your sign-in wallet`}
            />
          ))}
          <Choice
            checked={to === null}
            onSelect={() => setTo(null)}
            title="Another address"
            description={`Paste an address on ${network.name}`}
          />
          {to === null ? (
            <div className="px-3.5 pb-3">
              <input
                autoFocus
                value={typed}
                aria-label="Destination address"
                aria-invalid={(typed.length > 0 && !valid) || undefined}
                placeholder={family === "evm" ? "0x…" : "Solana address"}
                onChange={(event) => setTyped(event.target.value)}
                className="border-aomi-border bg-aomi-bg type-address rounded-control h-8 w-full border px-2 outline-none"
              />
            </div>
          ) : null}
        </ListGroup>
      </fieldset>
      <ListGroup>
        <ListRow
          title={`${plural(chosen.length, "transfer")} on ${network.name}`}
          description={chosen
            .map((pick) => `${pick.max ? "all" : pick.amount} ${pick.symbol}`)
            .join(" + ")}
        />
      </ListGroup>
      {error ? <SheetAlert>{error}</SheetAlert> : null}
      {busy ? (
        <WaitingButton>Withdrawing…</WaitingButton>
      ) : (
        <AomiButton
          variant="primary"
          className="h-10 w-full"
          disabled={!valid && !ref}
          onClick={() => void withdraw()}
        >
          {ref ? "Try again" : "Withdraw"}
        </AomiButton>
      )}
      <SheetFootnote>
        You approve it here. It doesn’t wait on any connection’s Ask setting.
      </SheetFootnote>
    </div>
  );
}

function Choice({
  checked,
  onSelect,
  leading,
  title,
  description,
}: {
  checked: boolean;
  onSelect: () => void;
  leading?: ReactNode;
  title: string;
  description: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      onClick={onSelect}
      className="hover:bg-aomi-hover flex w-full items-center gap-3 px-3.5 py-2.5 text-left outline-none transition-colors"
    >
      <span
        aria-hidden
        className={cn(
          "flex size-4 shrink-0 items-center justify-center rounded-full border-[1.5px]",
          checked ? "border-aomi-fg" : "border-aomi-border",
        )}
      >
        {checked ? <span className="bg-aomi-fg size-2 rounded-full" /> : null}
      </span>
      {leading}
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="type-row truncate">{title}</span>
        <span className="type-address text-aomi-muted truncate">
          {description}
        </span>
      </span>
    </button>
  );
}

/** The approved withdrawal, followed until every transfer in it lands. */
function Sent({
  handle,
  network,
  onClose,
}: {
  handle: CommitHandle;
  network: AomiAgentWalletNetwork;
  onClose: () => void;
}) {
  const [, rerender] = useReducer((count: number) => count + 1, 0);
  useEffect(() => handle.subscribe(rerender), [handle]);
  useEffect(() => () => handle.close(), [handle]);
  const { done, confirmed, failed } = handle.settled;
  const transfers = handle.batch;
  const sent = transfers.filter((view) => view.state === "confirmed").length;
  return (
    <>
      <SheetHeader
        title={
          confirmed
            ? "Withdrawn"
            : done
              ? "The withdrawal didn’t go through"
              : "Withdrawing…"
        }
        description={
          confirmed
            ? `Sent on ${network.name}.`
            : done
              ? sent
                ? `${sent} of ${transfers.length} transfers were sent; the rest weren’t. Try again from the wallet’s menu.`
                : "Nothing more will be sent. Try again from the wallet’s menu."
              : `Aomi signs and sends it on ${network.name}.`
        }
        onClose={onClose}
      />
      <div
        data-commit-ref={handle.ref}
        data-commit-state={
          failed?.state ?? (done ? "confirmed" : handle.view.state)
        }
        className="flex flex-col items-center gap-4 px-5 pb-5"
      >
        {confirmed ? (
          <CircleCheck
            className="text-aomi-success size-12"
            strokeWidth={1.5}
          />
        ) : !done ? (
          <WaitingButton>Sending…</WaitingButton>
        ) : null}
        {transfers.map((view, index) =>
          view.transaction_url ? (
            <a
              key={view.commit_id}
              href={view.transaction_url}
              target="_blank"
              rel="noreferrer"
              className="type-meta text-aomi-muted hover:text-aomi-fg underline underline-offset-2"
            >
              {transfers.length > 1
                ? `View transfer ${index + 1} on explorer`
                : "View on explorer"}
            </a>
          ) : null,
        )}
        {done ? (
          <AomiButton className="h-10 w-full" onClick={onClose}>
            Done
          </AomiButton>
        ) : null}
      </div>
    </>
  );
}
