"use client";

import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import * as Dialog from "@radix-ui/react-dialog";
import {
  Check,
  ChevronLeft,
  CircleCheck,
  CreditCard,
  Lock,
} from "lucide-react";
import {
  createPublicClient,
  erc20Abi,
  getAddress,
  http,
  type Address,
} from "viem";
import { arbitrum, base, baseSepolia, mainnet, optimism } from "viem/chains";
import { useShellTransport } from "@/account/transport";
import type { AomiWalletKit } from "@/wallet/types";
import {
  AomiCreditApiError,
  shortAddress,
  type AccountCreditsTransport,
  type AomiFundingResult,
  type AomiCreditMethods,
  type AomiFundingEvent,
} from "@aomi-labs/client";
import { useWidgetOverlay } from "@/ui/widget-scope";
import { createWidgetX402Client } from "@/wallet/payment-client";
import { useAomiWalletKit } from "@/wallet/context";
import { cn } from "@/lib/cn";
import { AomiButton } from "@/ui/aomi/button";
import { ListGroup } from "@/ui/aomi/list-group";
import { LoadingPane } from "@/ui/aomi/loading-pane";
import { SectionHeader } from "@/ui/aomi/section-header";
import { getChainIcon } from "@/icons/chain-map";
import {
  ChoiceRow,
  SheetAlert,
  SheetFootnote,
  SheetHeader,
} from "@/wallet/picker/sheet-parts";
import { BrandMark } from "@/account/account-management/controls";
import { appName, rowTitle } from "@/account/account-management/wallet-model";
import { PendingMark } from "@/ui/aomi/status-pill";
import { useAccountCredits } from "@/account/use-account-credits";
import { billingFromPosition, formatDollars } from "./format";

const CardForm = lazy(() => import("./card-form"));
const chains = [mainnet, arbitrum, base, optimism, baseSepolia];
const PRESETS = [5, 10, 25, 50, 100];
const MAX_MICROUSD = 1_000_000_000;

type Step = "amount" | "method" | "card" | "wallet";
type Network = AomiCreditMethods["wallet"]["networks"][number];

/**
 * Add funds, one decision per step: how much, then card (Stripe) or crypto
 * (USDC over x402), then that rail's own screen. Steps come and go like the
 * wallet picker's: a back arrow, no progress bar.
 */
export function CreditCheckoutDialog({
  open,
  onClose,
  onSuccess,
  credits: suppliedCredits,
  wallet: suppliedWallet,
}: {
  credits?: AccountCreditsTransport;
  wallet?: Pick<
    AomiWalletKit,
    | "identity"
    | "signTypedData"
    | "switchChain"
    | "connect"
    | "wallets"
    | "activateWallet"
  >;
  open: boolean;
  onClose: () => void;
  onSuccess: () => Promise<void>;
}) {
  const overlay = useWidgetOverlay();
  const transport = useShellTransport();
  const creditsApi = suppliedCredits ?? transport.aomi.account.credits;
  const connectedWallet = useAomiWalletKit();
  const wallet = suppliedWallet ?? connectedWallet;
  const position = useAccountCredits();
  const balanceUsd = billingFromPosition(position.data)?.balanceUsd;
  const [methods, setMethods] = useState<AomiCreditMethods | null>(null);
  const [step, setStep] = useState<Step>("amount");
  const [dollars, setDollars] = useState("10");
  const [network, setNetwork] = useState("");
  const [fundingEvent, setFundingEvent] = useState<AomiFundingEvent | null>(
    null,
  );
  const [balances, setBalances] = useState<Record<string, bigint>>({});
  const [busy, setBusy] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const owner = useRef(creditsApi);
  const key = useRef<string>(crypto.randomUUID());
  const notified = useRef<string | null>(null);
  const amount = Math.round(Number(dollars) * 100) * 10_000;
  const cardMin = methods?.card?.min_microusd ?? 5_000_000;
  const walletMin = methods?.wallet.min_microusd ?? 1_000_000;
  const networks = methods?.wallet.networks ?? [];
  const cardOk = Boolean(methods?.card) && amount >= cardMin;
  const walletOk = networks.length > 0 && amount >= walletMin;
  const valid =
    Number.isFinite(amount) && amount <= MAX_MICROUSD && (cardOk || walletOk);
  const unavailable = methods !== null && !methods.card && !networks.length;
  const selected = networks.find((n) => n.network === network);
  const chain = chains.find((c) => `eip155:${c.id}` === network);
  const address = wallet.identity.address;
  const connected =
    wallet.identity.isConnected && address && wallet.signTypedData;
  const wrongNetwork = chain && wallet.identity.chainId !== chain.id;
  // Wallets that can sign the USDC authorization here: the account's own
  // EVM addresses, not agent wallets Aomi signs for.
  const payers = (wallet.wallets ?? []).filter(
    (row) => row.family === "evm" && row.kind !== "agent",
  );
  const balanceKey = (addr: string) => `${network}:${addr.toLowerCase()}`;
  const balance = address ? balances[balanceKey(address)] : undefined;
  const [switchingTo, setSwitchingTo] = useState<string | null>(null);
  const usd = formatDollars(amount / 1_000_000);
  const usdc = `${(amount / 1_000_000).toFixed(2)} USDC`;

  const accept = useCallback((next: AomiFundingResult) => {
    setFundingEvent(next.funding_event);
    setStep(next.funding_event.method === "card" ? "card" : "wallet");
    setDollars(String(next.funding_event.amount_microusd / 1_000_000));
    setNetwork(next.funding_event.terms.network ?? "");
    key.current = next.funding_event.idempotency_key;
    setWaiting(next.funding_event.status === "processing");
  }, []);

  useEffect(() => {
    if (!open) return;
    let active = true;
    if (owner.current !== creditsApi) {
      owner.current = creditsApi;
      setFundingEvent(null);
      setWaiting(false);
      setBusy(false);
      setMethods(null);
      key.current = crypto.randomUUID();
      notified.current = null;
    }
    setError(null);
    void Promise.all([
      creditsApi.methods(),
      creditsApi.fundingEvent("current").catch((e: unknown) => {
        if (e instanceof AomiCreditApiError && e.status === 404) return null;
        throw e;
      }),
    ])
      .then(([available, current]) => {
        if (!active) return;
        setMethods(available);
        if (current) accept(current);
        else if (!fundingEvent)
          setNetwork(available.wallet.networks[0]?.network ?? "");
      })
      .catch(() => {
        if (active)
          setError(
            "Payment options could not be loaded. Close and reopen to retry.",
          );
      });
    return () => {
      active = false;
    };
  }, [open, creditsApi, accept]);

  // Each payer's USDC on the picked network, so a short wallet shows before
  // it is picked.
  const payerList = payers.map((row) => row.address).join(",");
  useEffect(() => {
    const onChain = chains.find((c) => `eip155:${c.id}` === network);
    if (step !== "wallet" || !selected || !onChain) return;
    let active = true;
    const client = createPublicClient({ chain: onChain, transport: http() });
    const addresses = new Set(
      [address, ...payerList.split(",")].filter(Boolean) as string[],
    );
    for (const holder of addresses) {
      void client
        .readContract({
          address: selected.asset as Address,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [holder as Address],
        })
        .then((value) => {
          if (active)
            setBalances((current) => ({
              ...current,
              [`${network}:${holder.toLowerCase()}`]: value,
            }));
        })
        .catch(() => undefined);
    }
    return () => {
      active = false;
    };
  }, [step, network, selected?.asset, address, payerList]);

  useEffect(() => {
    if (
      !fundingEvent ||
      ["credited", "canceled", "failed"].includes(fundingEvent.status)
    )
      return;
    let active = true;
    const timer = setInterval(() => {
      void creditsApi
        .fundingEvent(fundingEvent.id)
        .then((next) => {
          if (!active) return;
          setFundingEvent(next.funding_event);
          setWaiting(next.funding_event.status === "processing");
        })
        .catch(() => {
          if (active)
            setError("Still checking your payment. Your payment is saved.");
        });
    }, 3000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [creditsApi, fundingEvent?.id, fundingEvent?.status]);

  useEffect(() => {
    if (
      fundingEvent?.status === "credited" &&
      notified.current !== fundingEvent.id
    ) {
      notified.current = fundingEvent.id;
      void onSuccess().catch(() =>
        setError("Payment completed. Reopen Billing to refresh your balance."),
      );
    }
  }, [fundingEvent, onSuccess]);

  async function begin() {
    setError(null);
    const method = step === "card" ? "card" : "wallet";
    const next = await creditsApi.beginFunding({
      amountMicrousd: amount,
      method,
      chain: method === "wallet" ? network : undefined,
      idempotencyKey: key.current,
      x402:
        method === "wallet" && selected
          ? createWidgetX402Client(wallet, {
              amountMicrousd: amount,
              network,
              asset: selected.asset,
              recipient: selected.recipient,
            })
          : undefined,
    });
    if (owner.current !== creditsApi)
      throw new Error(
        "Account changed. Reopen checkout for your current account.",
      );
    accept(next);
    return next;
  }
  async function cancel() {
    if (!fundingEvent) return;
    setBusy(true);
    setError(null);
    try {
      accept(await creditsApi.cancelFunding(fundingEvent.id));
    } catch {
      setError(
        "Cancellation could not be confirmed. Your payment is saved; we’ll keep checking.",
      );
    } finally {
      setBusy(false);
    }
  }
  // The sheet stays mounted between opens: a finished payment must not greet
  // the next one. An open payment is kept so it can be resumed.
  function close() {
    if (
      fundingEvent &&
      ["credited", "canceled", "failed"].includes(fundingEvent.status)
    )
      reset();
    onClose();
  }
  function reset() {
    setFundingEvent(null);
    setWaiting(false);
    setError(null);
    setStep("amount");
    setNetwork(networks[0]?.network ?? "");
    key.current = crypto.randomUUID();
  }
  async function payWallet() {
    setBusy(true);
    setError(null);
    try {
      if (!connected) {
        await wallet.connect({ family: "evm" });
        return;
      }
      if (wrongNetwork) {
        if (!wallet.switchChain)
          throw new Error("Switch your wallet to the selected network.");
        await wallet.switchChain(chain.id);
      }
      if (!walletOk || balance === undefined || balance < BigInt(amount))
        return;
      await begin();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Wallet payment was not completed.",
      );
      // Recover identity from Payment after a lost response, never infer success.
      try {
        const current = await creditsApi.fundingEvent("current");
        accept(current);
        if (["processing", "credited"].includes(current.funding_event.status))
          setError(null);
      } catch {
        /* preserve the same idempotency key */
      }
    } finally {
      setBusy(false);
    }
  }
  async function payWith(key: string) {
    if (!wallet.activateWallet || switchingTo) return;
    setSwitchingTo(key);
    setError(null);
    try {
      await wallet.activateWallet(key);
    } catch {
      setError("Couldn’t switch wallets. Try again from your wallet app.");
    } finally {
      setSwitchingTo(null);
    }
  }
  // With one rail set up, skip the choice. With both, always offer it, even
  // when the amount is under one rail's minimum: that rail shows why.
  const bothRails = Boolean(methods?.card) && networks.length > 0;
  function next() {
    if (bothRails) setStep("method");
    else setStep(cardOk ? "card" : "wallet");
  }

  const locked = busy || fundingEvent !== null;
  const back =
    step !== "amount" && !locked ? (
      <button
        type="button"
        aria-label="Back"
        onClick={() => {
          setError(null);
          setStep(step === "method" || !bothRails ? "amount" : "method");
        }}
        className="text-aomi-muted hover:bg-aomi-hover hover:text-aomi-fg -ml-1 flex size-7 shrink-0 items-center justify-center rounded-full transition-colors"
      >
        <ChevronLeft className="size-4" />
      </button>
    ) : undefined;

  let header: { title: string; description: string };
  let body: ReactNode;
  if (!methods && !error) {
    header = { title: "Add funds", description: "Loading payment options…" };
    body = <LoadingPane label="Loading payment options" className="min-h-40" />;
  } else if (unavailable) {
    header = { title: "Add funds", description: "Not available yet" };
    body = (
      <div className="flex flex-col items-center gap-2.5 py-2 text-center">
        <span className="border-aomi-border bg-aomi-surface-2 text-aomi-muted flex size-10 items-center justify-center rounded-xl border">
          <CreditCard className="size-[18px]" />
        </span>
        <p className="type-row mt-1">Adding funds isn’t available yet</p>
        <p className="type-meta text-aomi-muted mb-2 max-w-[300px]">
          Card and crypto payments aren’t turned on here. Your monthly allowance
          still refills each month.
        </p>
        <AomiButton className="h-10 w-full" onClick={close}>
          Close
        </AomiButton>
      </div>
    );
  } else if (fundingEvent?.status === "credited") {
    header = {
      title: "Funds added",
      description: "Your balance is up to date.",
    };
    body = (
      <div className="flex flex-col items-center gap-3 py-2 text-center">
        <CircleCheck className="text-aomi-success size-9" />
        <p className="text-lg font-semibold tabular-nums">
          {formatDollars(fundingEvent.amount_microusd / 1_000_000)} added
        </p>
        <AomiButton variant="primary" className="h-10 w-full" onClick={close}>
          Done
        </AomiButton>
        <button
          type="button"
          className="type-meta text-aomi-muted hover:text-aomi-fg"
          onClick={reset}
        >
          Add more
        </button>
      </div>
    );
  } else if (
    fundingEvent &&
    ["canceled", "failed"].includes(fundingEvent.status)
  ) {
    header = {
      title: "Payment not completed",
      description:
        fundingEvent.status === "canceled"
          ? "This payment was canceled."
          : "This payment could not be completed.",
    };
    body = (
      <AomiButton variant="primary" className="h-10 w-full" onClick={reset}>
        Try again
      </AomiButton>
    );
  } else if (waiting) {
    header = { title: `Paying ${usd}`, description: "Confirming your payment" };
    body = (
      <p role="status" className="type-meta text-aomi-muted py-4 text-center">
        This can take a few seconds. You can close this window; we’ll keep
        checking.
      </p>
    );
  } else if (step === "amount") {
    header = {
      title: "Add funds",
      description: "How much do you want to add?",
    };
    body = (
      <>
        <div className="border-aomi-border rounded-card flex flex-col items-center gap-3.5 border px-4 pb-4 pt-5">
          <label className="flex items-baseline gap-0.5">
            <span className="text-aomi-muted text-[32px] font-medium leading-10">
              $
            </span>
            <input
              aria-label="Amount in dollars"
              inputMode="decimal"
              value={dollars}
              onChange={(e) =>
                setDollars(e.target.value.replace(/[^\d.]/g, ""))
              }
              style={{ width: `${Math.max(1, dollars.length) + 0.5}ch` }}
              className="text-aomi-fg bg-transparent text-[44px] font-semibold tabular-nums leading-[48px] tracking-[-0.02em] outline-none"
            />
          </label>
          <div className="flex flex-wrap justify-center gap-1.5">
            {PRESETS.map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={Number(dollars) === value}
                onClick={() => setDollars(String(value))}
                className={cn(
                  "rounded-control h-8 border px-3 text-[13px] font-medium transition-colors",
                  Number(dollars) === value
                    ? "border-aomi-accent-outline bg-aomi-accent-tint"
                    : "border-aomi-border hover:bg-aomi-hover",
                )}
              >
                ${value}
              </button>
            ))}
          </div>
        </div>
        {balanceUsd !== undefined && valid ? (
          <div className="flex items-center justify-between px-0.5">
            <span className="type-meta text-aomi-muted">
              Added balance after
            </span>
            <span className="text-[13px] tabular-nums">
              <span className="text-aomi-muted">
                {formatDollars(balanceUsd)} →
              </span>{" "}
              <span className="font-semibold">
                {formatDollars(balanceUsd + amount / 1_000_000)}
              </span>
            </span>
          </div>
        ) : null}
        {!valid && dollars ? (
          <SheetAlert>
            Choose ${(Math.min(cardMin, walletMin) / 1_000_000).toFixed(0)} to
            $1,000.
          </SheetAlert>
        ) : null}
        <AomiButton
          variant="primary"
          className="h-10 w-full"
          disabled={!valid}
          onClick={next}
        >
          Continue
        </AomiButton>
        <SheetFootnote>
          Never expires. Used once your monthly allowance runs out.
        </SheetFootnote>
      </>
    );
  } else if (step === "method") {
    header = {
      title: `Pay ${usd}`,
      description: "Choose how you want to pay.",
    };
    body = (
      <>
        <ListGroup>
          <ChoiceRow
            leading={<StripeMark />}
            title="Card or wallet pay"
            description={
              <>
                Processed by Stripe ·{" "}
                {cardOk
                  ? `${formatDollars(cardMin / 1_000_000)} minimum`
                  : methods?.card
                    ? `Needs ${formatDollars(cardMin / 1_000_000)} or more`
                    : "Not available"}
              </>
            }
            disabled={!cardOk}
            onClick={() => setStep("card")}
          />
          <ChoiceRow
            leading={<UsdcMark />}
            title="Crypto"
            description={
              networks.length === 0
                ? "Not available"
                : networks.length <= 2
                  ? `USDC on ${networks.map((n) => n.name).join(" or ")}`
                  : `USDC on ${networks.length} networks`
            }
            disabled={!walletOk}
            onClick={() => setStep("wallet")}
          />
        </ListGroup>
        <SheetFootnote>
          Adding {usd} ·{" "}
          <button
            type="button"
            onClick={() => setStep("amount")}
            className="hover:text-aomi-fg underline underline-offset-2"
          >
            Change amount
          </button>
        </SheetFootnote>
      </>
    );
  } else if (step === "card") {
    header = {
      title: `Pay ${usd}`,
      description: "Card or wallet pay, through Stripe",
    };
    body =
      methods?.card && cardOk ? (
        <>
          <Suspense
            fallback={
              <LoadingPane
                label="Loading secure payment form"
                className="min-h-40"
              />
            }
          >
            <CardForm
              key={amount}
              onBusy={setBusy}
              publicKey={methods.card.public_key}
              amount={amount}
              disabled={busy}
              begin={begin}
              completed={() => setWaiting(true)}
              failed={setError}
            />
          </Suspense>
          <SheetFootnote className="flex items-center justify-center gap-1.5">
            <Lock className="size-3" /> Secured by Stripe. Aomi never sees your
            card.
          </SheetFootnote>
        </>
      ) : null;
  } else {
    const short = balance !== undefined && balance < BigInt(amount);
    header = {
      title: `Pay ${usd}`,
      description: "USDC from your wallet, settled over x402",
    };
    body = (
      <>
        <div className="border-aomi-border rounded-card flex items-center gap-3 border px-3.5 py-3">
          <UsdcMark size={36} />
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="text-[17px] font-semibold tabular-nums leading-6">
              {usdc}
            </span>
            {selected ? (
              <span className="type-meta text-aomi-muted flex min-w-0 items-center gap-1.5">
                <ChainIcon network={selected.network} size={12} />
                <span className="truncate">on {selected.name}</span>
              </span>
            ) : null}
          </div>
          <div className="flex shrink-0 flex-col items-end gap-0.5">
            <span className="text-[15px] font-semibold tabular-nums leading-6">
              +{usd}
            </span>
            <span className="type-meta text-aomi-muted">to your balance</span>
          </div>
        </div>
        {networks.length > 1 ? (
          <section className="flex flex-col gap-2">
            <SectionHeader title="Network" detail="Native USDC" />
            <div
              role="radiogroup"
              aria-label="Network"
              className="flex flex-wrap gap-1.5"
            >
              {networks.map((option) => (
                <button
                  key={option.network}
                  type="button"
                  role="radio"
                  aria-checked={option.network === network}
                  disabled={locked}
                  onClick={() => setNetwork(option.network)}
                  className={cn(
                    "rounded-control flex h-8 items-center gap-1.5 border px-2.5 text-[13px] transition-colors disabled:opacity-50",
                    option.network === network
                      ? "border-aomi-accent-outline bg-aomi-accent-tint font-medium"
                      : "border-aomi-border hover:bg-aomi-hover",
                  )}
                >
                  <ChainIcon network={option.network} size={14} />
                  {option.name}
                </button>
              ))}
            </div>
          </section>
        ) : null}
        <section className="flex flex-col gap-2">
          <SectionHeader
            title="Pay from"
            detail={payers.length > 1 ? "Tap a wallet to use it" : undefined}
          />
          {payers.length ? (
            <ListGroup role="radiogroup" aria-label="Paying wallet">
              {payers.map((row) => {
                const held = balances[balanceKey(row.address)];
                const pending = switchingTo === row.key || row.activating;
                return (
                  <button
                    key={row.key}
                    type="button"
                    role="radio"
                    aria-checked={Boolean(row.active)}
                    disabled={locked || Boolean(switchingTo) || row.active}
                    onClick={() => void payWith(row.key)}
                    className={cn(
                      "focus-visible:ring-aomi-ring/50 flex w-full items-center gap-3 px-3.5 py-2.5 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset",
                      row.active
                        ? "bg-aomi-surface-2/60"
                        : "hover:bg-aomi-hover disabled:opacity-60",
                    )}
                  >
                    <BrandMark
                      brand={appName(row)}
                      dot={row.connected ? "on" : "off"}
                    />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="type-row truncate">
                        {rowTitle(row).title}
                      </span>
                      <span className="type-address text-aomi-muted truncate">
                        {shortAddress(checksum(row.address))}
                      </span>
                    </span>
                    <span
                      className={cn(
                        "type-meta shrink-0 tabular-nums",
                        held !== undefined && held < BigInt(amount)
                          ? "text-aomi-muted"
                          : "text-aomi-fg",
                      )}
                    >
                      {held === undefined ? "—" : `${formatUsdc(held)} USDC`}
                    </span>
                    <span className="flex w-4 shrink-0 justify-end">
                      {pending ? (
                        <PendingMark />
                      ) : row.active ? (
                        <Check className="text-aomi-fg size-4" />
                      ) : null}
                    </span>
                  </button>
                );
              })}
            </ListGroup>
          ) : (
            <ListGroup>
              <ChoiceRow
                leading={<BrandMark brand="Wallet" />}
                title="Connect a wallet"
                description="It signs the USDC transfer"
                onClick={() => void wallet.connect({ family: "evm" })}
              />
            </ListGroup>
          )}
        </section>
        {connected && short && selected ? (
          <SheetAlert>
            This wallet has {formatUsdc(balance!)} USDC on {selected.name}. Pick
            another wallet or add USDC to it.
          </SheetAlert>
        ) : null}
        <AomiButton
          variant="primary"
          className="h-10 w-full"
          disabled={
            busy ||
            !walletOk ||
            !selected ||
            Boolean(switchingTo) ||
            (Boolean(connected) && (balance === undefined || short))
          }
          onClick={() => void payWallet()}
        >
          {busy
            ? "Confirm in your wallet…"
            : !connected
              ? "Connect wallet"
              : `Pay ${usdc}`}
        </AomiButton>
        <SheetFootnote>
          {wrongNetwork
            ? `Your wallet switches to ${selected?.name}, then asks for one signature. No gas.`
            : "One signature, no gas. Credited once it settles."}
        </SheetFootnote>
      </>
    );
  }

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(value) => {
        if (!value) close();
      }}
    >
      <Dialog.Portal container={overlay}>
        <Dialog.Overlay className="fixed inset-0 z-[80] bg-black/30 backdrop-blur-[3px]" />
        <Dialog.Content
          onOpenAutoFocus={(event) => {
            // Focus the sheet, not its ×: a ring there reads as a hover.
            event.preventDefault();
            (event.currentTarget as HTMLElement).focus();
          }}
          className="border-aomi-overlay-border bg-aomi-raised text-aomi-fg rounded-shell shadow-modal fixed left-1/2 top-1/2 z-[81] flex max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-[420px] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden border outline-none"
        >
          <SheetHeader
            title={header.title}
            description={header.description}
            leading={back}
            onClose={close}
          />
          <div className="flex min-h-0 flex-col gap-4 overflow-y-auto px-5 pb-5">
            {error ? <SheetAlert>{error}</SheetAlert> : null}
            {body}
            {fundingEvent?.status === "awaiting_action" ? (
              // Payment decides: card funding cancels its PaymentIntent; a
              // wallet funding cancels only while no authorization is signed.
              <button
                type="button"
                disabled={busy}
                className="type-meta text-aomi-muted hover:text-aomi-fg"
                onClick={() => void cancel()}
              >
                Cancel this payment
              </button>
            ) : null}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** Stripe's mark: the white S on its purple tile. */
function StripeMark({ size = 32 }: { size?: number }) {
  return (
    <span
      aria-hidden
      className="flex shrink-0 items-center justify-center rounded-[9px] bg-[#635bff]"
      style={{ width: size, height: size }}
    >
      <svg width={size * 0.56} height={size * 0.56} viewBox="0 0 24 24">
        <path
          fill="#fff"
          d="M13.976 9.15c-2.172-.806-3.356-1.426-3.356-2.409 0-.831.683-1.305 1.901-1.305 2.227 0 4.515.858 6.09 1.631l.89-5.494C18.252.975 15.697 0 12.165 0 9.667 0 7.589.654 6.104 1.872 4.56 3.147 3.757 4.992 3.757 7.218c0 4.039 2.467 5.76 6.476 7.219 2.585.92 3.445 1.574 3.445 2.583 0 .98-.84 1.545-2.354 1.545-1.875 0-4.965-.921-6.99-2.109l-.9 5.555C5.175 22.99 8.385 24 11.714 24c2.641 0 4.843-.624 6.328-1.813 1.664-1.305 2.525-3.236 2.525-5.732 0-4.128-2.524-5.851-6.594-7.305h.003z"
        />
      </svg>
    </span>
  );
}

/** Circle's USDC mark. */
function UsdcMark({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 2000 2000" aria-hidden>
      <circle cx="1000" cy="1000" r="1000" fill="#2775ca" />
      <path
        fill="#fff"
        d="M1275 1158.33c0-145.83-87.5-195.83-262.5-216.66-125-16.67-150-50-150-108.34s41.67-95.83 125-95.83c75 0 116.67 25 137.5 87.5 4.17 12.5 16.67 20.83 29.17 20.83h66.66c16.67 0 29.17-12.5 29.17-29.16v-4.17c-16.67-91.67-91.67-162.5-187.5-170.83v-100c0-16.67-12.5-29.17-33.33-33.34h-62.5c-16.67 0-29.17 12.5-33.34 33.34v95.83c-125 16.67-204.16 100-204.16 204.17 0 137.5 83.33 191.66 258.33 212.5 116.67 20.83 154.17 45.83 154.17 112.5s-58.34 112.5-137.5 112.5c-108.34 0-145.84-45.84-158.34-108.34-4.16-16.66-16.66-25-29.16-25h-70.84c-16.66 0-29.16 12.5-29.16 29.17v4.17c16.66 104.16 83.33 179.16 220.83 200v100c0 16.66 12.5 29.16 33.33 33.33h62.5c16.67 0 29.17-12.5 33.34-33.33v-100c125-20.84 208.33-108.34 208.33-220.84z"
      />
      <path
        fill="#fff"
        d="M787.5 1595.83c-325-116.66-491.67-479.16-370.83-800 62.5-175 200-308.33 370.83-370.83 16.67-8.33 25-20.83 25-41.67V325c0-16.67-8.33-29.17-25-33.33-4.17 0-12.5 0-16.67 4.16-395.83 125-612.5 545.84-487.5 941.67 75 233.33 254.17 412.5 487.5 487.5 16.67 8.33 33.34 0 37.5-16.67 4.17-4.16 4.17-8.33 4.17-16.66v-58.34c0-12.5-12.5-29.16-25-37.5zM1229.17 295.83c-16.67-8.33-33.34 0-37.5 16.67-4.17 4.17-4.17 8.33-4.17 16.67v58.33c0 16.67 12.5 33.33 25 41.67 325 116.66 491.67 479.16 370.83 800-62.5 175-200 308.33-370.83 370.83-16.67 8.33-25 20.83-25 41.67V1700c0 16.67 8.33 29.17 25 33.33 4.17 0 12.5 0 16.67-4.16 395.83-125 612.5-545.84 487.5-941.67-75-237.5-258.34-416.67-487.5-491.67z"
      />
    </svg>
  );
}

const formatUsdc = (value: bigint) => (Number(value) / 1_000_000).toFixed(2);

function checksum(address: string): string {
  try {
    return getAddress(address);
  } catch {
    return address;
  }
}

function ChainIcon({ network, size }: { network: string; size: number }) {
  const Icon = getChainIcon(Number(network.split(":")[1]));
  return Icon ? <Icon width={size} height={size} aria-hidden /> : null;
}
