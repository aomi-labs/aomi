"use client";

import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { ArrowLeft, ChevronDown, Wallet, X } from "lucide-react";
import { createPublicClient, erc20Abi, http, type Address } from "viem";
import { arbitrum, base, baseSepolia, mainnet, optimism } from "viem/chains";
import { useShellTransport } from "@/account/transport";
import type { AomiWalletKit } from "@/wallet/types";
import {
  AomiCreditApiError,
  type AccountCreditsTransport,
  type AomiFundingResult,
  type AomiCreditMethods,
  type AomiFundingEvent,
} from "@aomi-labs/client";
import { useWidgetOverlay } from "@/ui/widget-scope";
import { createWidgetX402Client } from "@/wallet/payment-client";
import { useAomiWalletKit } from "@/wallet/context";

const CardForm = lazy(() => import("./card-form"));
const chains = [mainnet, arbitrum, base, optimism, baseSepolia];

/** The host's authorization for this account lapsed; reconnecting can restore it. */
function needsReconnect(error: unknown): boolean {
  if (error instanceof AomiCreditApiError) return error.status === 401;
  return (
    error instanceof Error &&
    (error as { code?: unknown }).code === "reauthorization_required"
  );
}

export function CreditCheckoutDialog({
  open,
  onClose,
  onSuccess,
  credits: suppliedCredits,
  wallet: suppliedWallet,
  reconnect,
}: {
  credits?: AccountCreditsTransport;
  /**
   * Renew the host's authorization for the same account. Checkout keeps its
   * amount, method and funding event while this runs, so the host must keep
   * `credits` the same object and reject (never switch) a different account.
   */
  reconnect?: () => Promise<void>;
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
  const creditsApi = suppliedCredits ?? transport.client.account.credits;
  const connectedWallet = useAomiWalletKit();
  const wallet = suppliedWallet ?? connectedWallet;
  const [methods, setMethods] = useState<AomiCreditMethods | null>(null);
  const [method, setMethod] = useState<"card" | "wallet">("wallet");
  const [cardPanel, setCardPanel] = useState(false);
  const backButton = useRef<HTMLButtonElement>(null);
  const cardButton = useRef<HTMLButtonElement>(null);
  const [credits, setCredits] = useState("1000");
  const [network, setNetwork] = useState("");
  const [fundingEvent, setFundingEvent] = useState<AomiFundingEvent | null>(
    null,
  );
  const [balance, setBalance] = useState<bigint | null>(null);
  const [busy, setBusy] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reconnecting, setReconnecting] = useState<"needed" | "busy" | null>(
    null,
  );
  const [reconnectError, setReconnectError] = useState<string | null>(null);
  const [loads, setLoads] = useState(0);
  const owner = useRef(creditsApi);
  const key = useRef<string>(crypto.randomUUID());
  const notified = useRef<string | null>(null);
  const amount = Number(credits) * 10_000;
  const valid =
    Number.isSafeInteger(Number(credits)) &&
    amount >= (method === "card" ? 5_000_000 : 1_000_000) &&
    amount <= 1_000_000_000;
  const locked = busy || fundingEvent !== null || reconnecting !== null;
  const selected = methods?.wallet.networks.find((n) => n.network === network);
  const chain = chains.find((c) => `eip155:${c.id}` === network);
  const connected =
    wallet.identity.isConnected &&
    wallet.identity.address &&
    wallet.signTypedData;
  const wrongNetwork = chain && wallet.identity.chainId !== chain.id;
  const settled = fundingEvent?.status === "credited";

  const accept = useCallback((next: AomiFundingResult) => {
    setFundingEvent(next.funding_event);
    setMethod(next.funding_event.method);
    setCardPanel(next.funding_event.method === "card");
    setCredits(String(next.funding_event.amount_microusd / 10_000));
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
      setReconnecting(null);
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
        else if (!fundingEvent) {
          setMethod(available.wallet.networks.length ? "wallet" : "card");
          setCardPanel(false);
          setNetwork(available.wallet.networks[0]?.network ?? "");
        }
      })
      .catch((e: unknown) => {
        if (!active) return;
        if (reconnect && needsReconnect(e)) setReconnecting("needed");
        else
          setError(
            "Payment options could not be loaded. Close and reopen to retry.",
          );
      });
    return () => {
      active = false;
    };
  }, [open, creditsApi, accept, loads]);

  useEffect(() => {
    setBalance(null);
    if (method !== "wallet" || !chain || !selected || !wallet.identity.address)
      return;
    let active = true;
    const client = createPublicClient({ chain, transport: http() });
    void client
      .readContract({
        address: selected.asset as Address,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [wallet.identity.address as Address],
      })
      .then((value) => {
        if (active) setBalance(value);
      })
      .catch(() => {
        if (active)
          setError("Could not check your USDC balance. Try again shortly.");
      });
    return () => {
      active = false;
    };
  }, [method, network, selected, wallet.identity.address, chain]);

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
        .catch((e: unknown) => {
          if (!active) return;
          if (reconnect && needsReconnect(e)) setReconnecting("needed");
          else setError("Still checking your payment. Your payment is saved.");
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
        setError(
          "Payment completed. Reopen your credit balance to refresh it.",
        ),
      );
    }
  }, [fundingEvent, onSuccess]);

  async function begin() {
    setError(null);
    if (reconnecting)
      throw new Error("Reconnect Aomi before continuing this payment.");
    const next = await creditsApi
      .beginFunding({
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
      })
      .catch((e: unknown) => {
        // A refused credential never reaches Payment, so no funding event
        // exists yet; the same idempotency key is reused after reconnecting.
        if (reconnect && needsReconnect(e)) setReconnecting("needed");
        throw e;
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
  async function restore() {
    if (!reconnect) return;
    setReconnecting("busy");
    setReconnectError(null);
    try {
      await reconnect();
      setReconnecting(null);
      setError(null);
      // Reload methods and any funding event Payment already holds.
      setLoads((count) => count + 1);
    } catch (e) {
      setReconnecting("needed");
      setReconnectError(
        e instanceof Error ? e.message : "Aomi could not be reconnected.",
      );
    }
  }
  function reset() {
    setFundingEvent(null);
    setWaiting(false);
    setError(null);
    setMethod(methods?.wallet.networks.length ? "wallet" : "card");
    setCardPanel(false);
    setNetwork(methods?.wallet.networks[0]?.network ?? "");
    setCredits("1000");
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
      if (!valid || balance === null || balance < BigInt(amount)) return;
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

  useEffect(() => {
    if (cardPanel) backButton.current?.focus();
  }, [cardPanel]);

  const paymentContent = (
    <>
      <div className="border-aomi-border flex justify-between rounded-xl border p-4">
        <span>{valid ? Number(credits).toLocaleString() : "—"} credits</span>
        <b>
          {valid
            ? `${method === "card" ? "$" : ""}${(amount / 1_000_000).toFixed(2)}${method === "wallet" ? " USDC" : ""}`
            : "—"}
        </b>
      </div>
      {!valid && (
        <p role="alert" className="text-aomi-danger text-xs">
          Choose {method === "card" ? "500" : "100"}–100,000 whole credits.
        </p>
      )}
      {error && !reconnecting && (
        <p role="alert" className="text-aomi-danger text-xs">
          {error}
        </p>
      )}
      {reconnecting ? (
        <div className="border-aomi-border flex flex-col gap-3 rounded-xl border p-4">
          <p role="status" className="text-sm">
            Your Aomi sign-in for this account expired. Reconnect to continue;
            your amount and payment method are kept, and you won’t be charged
            twice.
          </p>
          {reconnectError && (
            <p role="alert" className="text-aomi-danger text-xs">
              {reconnectError}
            </p>
          )}
          <button
            disabled={reconnecting === "busy"}
            className="bg-aomi-fg text-aomi-bg rounded-xl p-3 disabled:opacity-40"
            onClick={() => void restore()}
          >
            {reconnecting === "busy" ? "Reconnecting…" : "Reconnect Aomi"}
          </button>
        </div>
      ) : fundingEvent &&
        ["canceled", "failed"].includes(fundingEvent.status) ? (
        <>
          <p role="status">
            This payment{" "}
            {fundingEvent.status === "canceled"
              ? "was canceled"
              : "could not be completed"}
            .
          </p>
          <button onClick={reset}>Choose a new payment</button>
        </>
      ) : settled ? (
        <>
          <p role="status" className="text-aomi-success text-sm">
            {Number(credits).toLocaleString()} credits added. Your balance is up
            to date.
          </p>
          <button
            className="bg-aomi-fg text-aomi-bg rounded-xl p-3"
            onClick={onClose}
          >
            Return and retry your task
          </button>
          <button className="text-aomi-muted text-xs" onClick={reset}>
            Add more credits
          </button>
        </>
      ) : waiting ? (
        <p role="status" className="text-aomi-muted text-sm">
          Confirming your payment. You can close this window; we’ll keep
          checking.
        </p>
      ) : method === "card" && methods?.card && valid ? (
        <Suspense fallback={<p>Loading secure payment form…</p>}>
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
      ) : method === "card" && !valid ? null : method === "wallet" ? (
        <>
          <label className="text-aomi-muted text-xs">
            Network
            <span className="relative mt-2 block">
              <select
                aria-label="Payment network"
                value={network}
                disabled={locked}
                onChange={(e) => setNetwork(e.target.value)}
                className="bg-aomi-bg border-aomi-border text-aomi-fg focus-visible:ring-aomi-accent/40 min-h-12 w-full appearance-none rounded-xl border py-3 pl-4 pr-10 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 disabled:opacity-50"
              >
                {methods?.wallet.networks.map((n) => (
                  <option key={n.network} value={n.network}>
                    {n.name} · native USDC
                  </option>
                ))}
              </select>
              <ChevronDown
                size={16}
                aria-hidden="true"
                className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2"
              />
            </span>
          </label>
          <div className="border-aomi-border bg-aomi-surface/30 rounded-xl border p-4">
            <div className="flex items-center gap-3">
              <span className="bg-aomi-surface-2 text-aomi-muted flex h-9 w-9 shrink-0 items-center justify-center rounded-lg">
                <Wallet size={18} aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <p className="text-aomi-muted text-xs">Paying wallet</p>
                <p className="text-aomi-fg mt-1 break-all text-sm font-medium">
                  {connected ? wallet.identity.address : "Connect your wallet"}
                </p>
              </div>
            </div>
            {connected ? (
              <div className="border-aomi-border mt-3 flex flex-wrap items-center justify-between gap-2 border-t pt-3 text-xs">
                <span className="text-aomi-muted">
                  Available on {selected?.name}
                </span>
                <span className="text-aomi-fg font-medium tabular-nums">
                  {balance === null
                    ? "Checking balance…"
                    : `${(Number(balance) / 1_000_000).toFixed(2)} USDC`}
                </span>
              </div>
            ) : (
              <p className="text-aomi-muted mt-3 text-xs leading-relaxed">
                Connect to check your USDC balance before paying.
              </p>
            )}
          </div>
          <details className="border-aomi-border group rounded-xl border text-xs">
            <summary className="text-aomi-muted focus-visible:ring-aomi-accent/40 flex cursor-pointer list-none items-center justify-between gap-2 rounded-xl p-4 focus-visible:outline-none focus-visible:ring-2 [&::-webkit-details-marker]:hidden">
              Review payment details
              <ChevronDown
                size={15}
                aria-hidden="true"
                className="shrink-0 transition-transform group-open:rotate-180"
              />
            </summary>
            <dl className="border-aomi-border mx-4 space-y-3 border-t py-4">
              <div>
                <dt className="text-aomi-muted">Treasury recipient</dt>
                <dd className="text-aomi-fg mt-1 break-all font-mono leading-relaxed">
                  {selected?.recipient ?? "—"}
                </dd>
              </div>
              <div>
                <dt className="text-aomi-muted">Native USDC contract</dt>
                <dd className="text-aomi-fg mt-1 break-all font-mono leading-relaxed">
                  {selected?.asset ?? "—"}
                </dd>
              </div>
            </dl>
          </details>
          {balance !== null && balance < BigInt(valid ? amount : 0) && (
            <p role="alert" className="text-aomi-danger text-xs">
              Insufficient USDC on {selected?.name}. Add USDC or choose Card.
            </p>
          )}
          <button
            disabled={
              busy ||
              !valid ||
              !selected ||
              (Boolean(connected) &&
                !wrongNetwork &&
                (balance === null || balance < BigInt(amount)))
            }
            onClick={() => void payWallet()}
            className="bg-aomi-fg text-aomi-bg rounded-xl p-3 disabled:opacity-40"
          >
            {busy
              ? "Confirm in wallet…"
              : !connected
                ? "Connect wallet"
                : wrongNetwork
                  ? `Switch to ${selected?.name}`
                  : `Pay ${(amount / 1_000_000).toFixed(2)} USDC`}
          </button>
        </>
      ) : !methods ? (
        <p>Loading payment options…</p>
      ) : (
        <p>Payments are temporarily unavailable.</p>
      )}
      {fundingEvent?.status === "awaiting_action" && (
        // Payment decides: card funding cancels its PaymentIntent; a
        // wallet funding cancels only while no authorization is signed.
        <button
          disabled={busy}
          className="text-aomi-muted text-xs"
          onClick={() => void cancel()}
        >
          Cancel this payment
        </button>
      )}
    </>
  );

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(value) => {
        if (!value) onClose();
      }}
    >
      <Dialog.Portal container={overlay}>
        <Dialog.Overlay className="fixed inset-0 z-[80] bg-black/30 backdrop-blur-[3px]" />
        <Dialog.Content className="border-aomi-overlay-border bg-aomi-raised text-aomi-fg fixed left-1/2 top-1/2 z-[81] flex h-[min(760px,calc(100dvh-2rem))] w-[calc(100%-2rem)] max-w-[480px] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border shadow-2xl">
          <div className="border-aomi-border relative shrink-0 border-b p-5">
            {cardPanel && (
              <button
                ref={backButton}
                aria-label="Back to amount and payment method"
                disabled={busy}
                onClick={() => {
                  setCardPanel(false);
                  requestAnimationFrame(() => cardButton.current?.focus());
                }}
                className="mb-3 flex items-center gap-2 text-sm disabled:opacity-50"
              >
                <ArrowLeft size={16} /> Back
              </button>
            )}
            <Dialog.Title className="text-lg font-semibold">
              {cardPanel ? "Pay by card" : "Add credits"}
            </Dialog.Title>
            <Dialog.Description className="text-aomi-muted mt-1 text-sm">
              {cardPanel
                ? "Complete your secure payment."
                : "Choose how you’d like to pay."}
            </Dialog.Description>
            <Dialog.Close
              aria-label="Close checkout"
              className="absolute right-4 top-4 rounded-full p-2"
            >
              <X size={18} />
            </Dialog.Close>
          </div>
          <div className="relative min-h-0 flex-1 overflow-hidden">
            <div
              aria-hidden={cardPanel}
              inert={cardPanel}
              className={`absolute inset-0 flex flex-col gap-4 overflow-y-auto overscroll-contain p-5 transition-transform duration-300 motion-reduce:transition-none ${cardPanel ? "-translate-x-full" : "translate-x-0"}`}
            >
              <div className="grid grid-cols-3 gap-2">
                {[500, 1000, 5000].map((value) => (
                  <button
                    key={value}
                    disabled={locked}
                    aria-pressed={credits === String(value)}
                    onClick={() => setCredits(String(value))}
                    className="border-aomi-border rounded-xl border p-3 text-left disabled:opacity-50"
                  >
                    <b className="block">{value.toLocaleString()}</b>
                    <small className="text-aomi-muted">
                      ${(value / 100).toFixed(2)}
                    </small>
                  </button>
                ))}
              </div>
              <label className="text-aomi-muted text-xs">
                Custom amount · credits
                <input
                  aria-label="Top-up credits"
                  type="number"
                  step={1}
                  min={method === "card" ? 500 : 100}
                  max={100000}
                  value={credits}
                  disabled={locked}
                  onChange={(e) => setCredits(e.target.value)}
                  className="bg-aomi-bg border-aomi-border text-aomi-fg mt-2 w-full rounded-xl border p-3 text-sm"
                />
              </label>
              <small className="text-aomi-muted">100 credits = $1.00</small>
              <div
                className="grid grid-cols-2 gap-2"
                role="group"
                aria-label="Payment method"
              >
                {(["wallet", "card"] as const).map((value) => (
                  <button
                    key={value}
                    ref={value === "card" ? cardButton : undefined}
                    disabled={
                      (locked && method !== value) ||
                      (value === "card"
                        ? !methods?.card
                        : !methods?.wallet.networks.length)
                    }
                    aria-pressed={method === value}
                    onClick={() => {
                      setMethod(value);
                      setCardPanel(value === "card");
                      setError(null);
                    }}
                    className={`rounded-xl border p-3 text-left disabled:opacity-50 ${method === value ? "border-aomi-accent-outline bg-aomi-accent-tint" : "border-aomi-border"}`}
                  >
                    <b className="block">
                      {value === "card" ? "Card" : "USDC"}
                    </b>
                    <small className="text-aomi-muted">
                      {value === "card"
                        ? "Card · Apple Pay · Link"
                        : "Wallet payment"}
                    </small>
                  </button>
                ))}
              </div>
              {method === "wallet" ? (
                paymentContent
              ) : (
                <button
                  className="bg-aomi-fg text-aomi-bg rounded-xl p-3"
                  onClick={() => setCardPanel(true)}
                >
                  Continue to card payment
                </button>
              )}
            </div>
            <div
              aria-hidden={!cardPanel}
              inert={!cardPanel}
              className={`absolute inset-0 flex flex-col gap-4 overflow-y-auto overscroll-contain p-5 transition-transform duration-300 motion-reduce:transition-none ${cardPanel ? "translate-x-0" : "translate-x-full"}`}
            >
              {cardPanel && paymentContent}
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
