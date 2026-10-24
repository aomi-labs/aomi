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
import { ChevronDown, Wallet, X } from "lucide-react";
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

export function CreditTopUpDialog({
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
  const creditsApi = suppliedCredits ?? transport.client.account.credits;
  const connectedWallet = useAomiWalletKit();
  const wallet = suppliedWallet ?? connectedWallet;
  const [methods, setMethods] = useState<AomiCreditMethods | null>(null);
  const [method, setMethod] = useState<"card" | "wallet">("card");
  const [credits, setCredits] = useState("1000");
  const [network, setNetwork] = useState("");
  const [purchase, setPurchase] = useState<AomiFundingEvent | null>(null);
  const [balance, setBalance] = useState<bigint | null>(null);
  const [busy, setBusy] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const owner = useRef(creditsApi);
  const key = useRef<string>(crypto.randomUUID());
  const notified = useRef<string | null>(null);
  const amount = Number(credits) * 10_000;
  const valid =
    Number.isSafeInteger(Number(credits)) &&
    amount >= (method === "card" ? 5_000_000 : 1_000_000) &&
    amount <= 1_000_000_000;
  const locked = busy || purchase !== null;
  const selected = methods?.wallet.networks.find((n) => n.network === network);
  const chain = chains.find((c) => `eip155:${c.id}` === network);
  const connected =
    wallet.identity.isConnected &&
    wallet.identity.address &&
    wallet.signTypedData;
  const wrongNetwork = chain && wallet.identity.chainId !== chain.id;
  const settled = purchase?.status === "credited";

  const accept = useCallback((next: AomiFundingResult) => {
    setPurchase(next.funding_event);
    setMethod(next.funding_event.method);
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
      setPurchase(null);
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
        else if (!purchase) {
          setMethod(available.card ? "card" : "wallet");
          setNetwork(available.wallet.networks[0]?.network ?? "");
        }
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
      !purchase ||
      ["credited", "canceled", "failed"].includes(purchase.status)
    )
      return;
    let active = true;
    const timer = setInterval(() => {
      void creditsApi
        .fundingEvent(purchase.id)
        .then((next) => {
          if (!active) return;
          setPurchase(next.funding_event);
          setWaiting(next.funding_event.status === "processing");
        })
        .catch(() => {
          if (active)
            setError("Still checking your payment. Your purchase is saved.");
        });
    }, 3000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [creditsApi, purchase?.id, purchase?.status]);

  useEffect(() => {
    if (purchase?.status === "credited" && notified.current !== purchase.id) {
      notified.current = purchase.id;
      void onSuccess().catch(() =>
        setError(
          "Payment completed. Reopen your credit balance to refresh it.",
        ),
      );
    }
  }, [purchase, onSuccess]);

  async function begin() {
    setError(null);
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
    if (!purchase) return;
    setBusy(true);
    setError(null);
    try {
      accept(await creditsApi.cancelFunding(purchase.id));
    } catch {
      setError(
        "Cancellation could not be confirmed. Your purchase is saved; we’ll keep checking.",
      );
    } finally {
      setBusy(false);
    }
  }
  function reset() {
    setPurchase(null);
    setWaiting(false);
    setError(null);
    setMethod(methods?.card ? "card" : "wallet");
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

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(value) => {
        if (!value) onClose();
      }}
    >
      <Dialog.Portal container={overlay}>
        <Dialog.Overlay className="fixed inset-0 z-[80] bg-black/30 backdrop-blur-[3px]" />
        <Dialog.Content className="border-aomi-overlay-border bg-aomi-raised text-aomi-fg fixed left-1/2 top-1/2 z-[81] max-h-[calc(100vh-2rem)] w-[calc(100%-2rem)] max-w-[480px] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border shadow-2xl">
          <div className="border-aomi-border relative border-b p-5">
            <Dialog.Title className="text-lg font-semibold">
              Add credits
            </Dialog.Title>
            <Dialog.Description className="text-aomi-muted mt-1 text-sm">
              Choose how you’d like to pay.
            </Dialog.Description>
            <Dialog.Close
              aria-label="Close top-up"
              className="absolute right-4 top-4 rounded-full p-2"
            >
              <X size={18} />
            </Dialog.Close>
          </div>
          <div className="flex flex-col gap-4 p-5">
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
              {(["card", "wallet"] as const).map((value) => (
                <button
                  key={value}
                  disabled={
                    locked ||
                    (value === "card"
                      ? !methods?.card
                      : !methods?.wallet.networks.length)
                  }
                  aria-pressed={method === value}
                  onClick={() => {
                    setMethod(value);
                    setError(null);
                  }}
                  className={`rounded-xl border p-3 text-left disabled:opacity-50 ${method === value ? "border-aomi-accent-outline bg-aomi-accent-tint" : "border-aomi-border"}`}
                >
                  <b className="block">{value === "card" ? "Card" : "USDC"}</b>
                  <small className="text-aomi-muted">
                    {value === "card"
                      ? "Card · Apple Pay · Link"
                      : "Wallet payment"}
                  </small>
                </button>
              ))}
            </div>
            <div className="border-aomi-border flex justify-between rounded-xl border p-4">
              <span>
                {valid ? Number(credits).toLocaleString() : "—"} credits
              </span>
              <b>
                {valid
                  ? `${method === "card" ? "$" : ""}${(amount / 1_000_000).toFixed(2)}${method === "wallet" ? " USDC" : ""}`
                  : "—"}
              </b>
            </div>
            {!valid && (
              <p role="alert" className="text-aomi-danger text-xs">
                Choose {method === "card" ? "500" : "100"}–100,000 whole
                credits.
              </p>
            )}
            {error && (
              <p role="alert" className="text-aomi-danger text-xs">
                {error}
              </p>
            )}
            {purchase && ["canceled", "failed"].includes(purchase.status) ? (
              <>
                <p role="status">
                  This payment{" "}
                  {purchase.status === "canceled"
                    ? "was canceled"
                    : "could not be completed"}
                  .
                </p>
                <button onClick={reset}>Choose a new payment</button>
              </>
            ) : settled ? (
              <>
                <p role="status" className="text-aomi-success text-sm">
                  {Number(credits).toLocaleString()} credits added. Your balance
                  is up to date.
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
            ) : method === "wallet" ? (
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
                        {connected
                          ? wallet.identity.address
                          : "Connect your wallet"}
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
                    Insufficient USDC on {selected?.name}. Add USDC or choose
                    Card.
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
            {purchase?.status === "awaiting_action" && (
              // Payment decides: a card purchase cancels its PaymentIntent; a
              // wallet purchase cancels only while no authorization is signed.
              <button
                disabled={busy}
                className="text-aomi-muted text-xs"
                onClick={() => void cancel()}
              >
                Cancel this payment
              </button>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
