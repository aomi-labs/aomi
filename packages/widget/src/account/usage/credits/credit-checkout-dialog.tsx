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
  Wallet,
} from "lucide-react";
import { createPublicClient, erc20Abi, http, type Address } from "viem";
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
import { ListGroup, ListRow } from "@/ui/aomi/list-group";
import { LoadingPane } from "@/ui/aomi/loading-pane";
import { SectionHeader } from "@/ui/aomi/section-header";
import { getChainIcon } from "@/icons/chain-map";
import {
  ChoiceRow,
  SheetAlert,
  SheetFootnote,
  SheetHeader,
} from "@/wallet/picker/sheet-parts";
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
    "identity" | "signTypedData" | "switchChain" | "connect"
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
  const balance = balances[network];
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

  // Each network's USDC in the paying wallet, so a short one shows before
  // it is picked.
  useEffect(() => {
    if (step !== "wallet" || !address) return;
    let active = true;
    for (const option of networks) {
      const onChain = chains.find((c) => `eip155:${c.id}` === option.network);
      if (!onChain) continue;
      void createPublicClient({ chain: onChain, transport: http() })
        .readContract({
          address: option.asset as Address,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [address as Address],
        })
        .then((value) => {
          if (active)
            setBalances((current) => ({ ...current, [option.network]: value }));
        })
        .catch(() => undefined);
    }
    return () => {
      active = false;
    };
  }, [step, address, methods]);

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
        return;
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
  function next() {
    // With one rail on, skip the choice.
    if (cardOk && !walletOk) setStep("card");
    else if (walletOk && !cardOk) setStep("wallet");
    else setStep("method");
  }

  const locked = busy || fundingEvent !== null;
  const back =
    step !== "amount" && !locked ? (
      <button
        type="button"
        aria-label="Back"
        onClick={() => {
          setError(null);
          setStep(
            step === "method" || !(cardOk && walletOk) ? "amount" : "method",
          );
        }}
        className="text-aomi-muted hover:bg-aomi-hover hover:text-aomi-fg -ml-1 flex size-7 shrink-0 items-center justify-center rounded-full transition-colors"
      >
        <ChevronLeft className="size-4" />
      </button>
    ) : undefined;

  let header: { title: string; description: string; mark?: ReactNode };
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
        <AomiButton className="h-10 w-full" onClick={onClose}>
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
        <AomiButton variant="primary" className="h-10 w-full" onClick={onClose}>
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
              <span className="inline-flex items-center gap-1.5">
                USDC from your wallet
                {networks.map((n) => (
                  <ChainIcon key={n.network} network={n.network} size={12} />
                ))}
              </span>
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
      mark: <StripeMark size={28} />,
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
    header = {
      title: `Pay ${usdc}`,
      description: "From your wallet, settled over x402",
      mark: <UsdcMark size={28} />,
    };
    body = (
      <>
        <section className="flex flex-col gap-2">
          <SectionHeader title="Network" detail="Native USDC" />
          <ListGroup role="radiogroup" aria-label="Network">
            {networks.map((option) => {
              const held = balances[option.network];
              const short = held !== undefined && held < BigInt(amount);
              const picked = option.network === network;
              return (
                <button
                  key={option.network}
                  type="button"
                  role="radio"
                  aria-checked={picked}
                  disabled={locked || short}
                  onClick={() => setNetwork(option.network)}
                  className={cn(
                    "focus-visible:ring-aomi-ring/50 block w-full text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset disabled:opacity-50",
                    picked ? "bg-aomi-accent-tint" : "hover:bg-aomi-hover",
                  )}
                >
                  <ListRow
                    leading={
                      <ChainIcon network={option.network} size={20} tile />
                    }
                    title={option.name}
                    description={
                      !connected
                        ? "Connect a wallet to see your balance"
                        : held === undefined
                          ? "Checking balance…"
                          : `${(Number(held) / 1_000_000).toFixed(2)} USDC available${short ? " · not enough to pay" : ""}`
                    }
                    trailing={
                      picked ? (
                        <Check className="text-aomi-accent-strong size-4" />
                      ) : null
                    }
                  />
                </button>
              );
            })}
          </ListGroup>
        </section>
        <section className="flex flex-col gap-2">
          <SectionHeader title="Paying wallet" />
          <ListGroup>
            <ListRow
              leading={
                <span className="bg-aomi-surface-2 text-aomi-muted flex size-8 items-center justify-center rounded-[10px]">
                  <Wallet className="size-4" />
                </span>
              }
              title={connected ? shortAddress(address!) : "No wallet connected"}
              description={
                connected ? "Signs the USDC transfer" : "Connect one to pay"
              }
            />
          </ListGroup>
        </section>
        <AomiButton
          variant="primary"
          className="h-10 w-full"
          disabled={
            busy ||
            !walletOk ||
            !selected ||
            (Boolean(connected) &&
              !wrongNetwork &&
              (balance === undefined || balance < BigInt(amount)))
          }
          onClick={() => void payWallet()}
        >
          {busy
            ? "Confirm in your wallet…"
            : !connected
              ? "Connect wallet"
              : wrongNetwork
                ? `Switch to ${selected?.name}`
                : `Sign and pay ${usdc}`}
        </AomiButton>
        <SheetFootnote>
          One signature, no gas. Credited once it settles on {selected?.name}.
        </SheetFootnote>
      </>
    );
  }

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(value) => {
        if (!value) onClose();
      }}
    >
      <Dialog.Portal container={overlay}>
        <Dialog.Overlay className="fixed inset-0 z-[80] bg-black/30 backdrop-blur-[3px]" />
        <Dialog.Content className="border-aomi-overlay-border bg-aomi-raised text-aomi-fg rounded-shell shadow-modal fixed left-1/2 top-1/2 z-[81] flex max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-[420px] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden border">
          <SheetHeader
            title={header.title}
            description={header.description}
            leading={
              back || header.mark ? (
                <span className="flex items-center gap-2">
                  {back}
                  {header.mark}
                </span>
              ) : undefined
            }
            onClose={onClose}
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

function StripeMark({ size = 32 }: { size?: number }) {
  return (
    <span
      aria-hidden
      className="flex shrink-0 items-center justify-center rounded-[9px] bg-[#635bff] font-bold text-white"
      style={{ width: size, height: size, fontSize: size * 0.5 }}
    >
      S
    </span>
  );
}

function UsdcMark({ size = 32 }: { size?: number }) {
  return (
    <span
      aria-hidden
      className="flex shrink-0 items-center justify-center rounded-full bg-[#2775ca] font-bold text-white"
      style={{ width: size, height: size, fontSize: size * 0.47 }}
    >
      $
    </span>
  );
}

function ChainIcon({
  network,
  size,
  tile,
}: {
  network: string;
  size: number;
  tile?: boolean;
}) {
  const Icon = getChainIcon(Number(network.split(":")[1]));
  if (!Icon) return null;
  return tile ? (
    <span className="bg-aomi-surface-2 flex size-8 shrink-0 items-center justify-center rounded-[10px]">
      <Icon width={size} height={size} />
    </span>
  ) : (
    <Icon width={size} height={size} aria-hidden />
  );
}
