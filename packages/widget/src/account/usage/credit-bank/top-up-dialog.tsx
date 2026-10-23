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
import { X } from "lucide-react";
import { createPublicClient, erc20Abi, http, type Address } from "viem";
import { arbitrum, base, baseSepolia, mainnet, optimism } from "viem/chains";
import { useAomiRuntime } from "@aomi-labs/react";
import {
  AomiCreditApiError,
  type AomiCreditCheckout,
  type AomiCreditMethods,
  type AomiCreditPurchase,
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
}: {
  open: boolean;
  onClose: () => void;
  onSuccess: () => Promise<void>;
}) {
  const overlay = useWidgetOverlay();
  const { account } = useAomiRuntime();
  const wallet = useAomiWalletKit();
  const [methods, setMethods] = useState<AomiCreditMethods | null>(null);
  const [method, setMethod] = useState<"card" | "wallet">("card");
  const [credits, setCredits] = useState("1000");
  const [network, setNetwork] = useState("");
  const [purchase, setPurchase] = useState<AomiCreditPurchase | null>(null);
  const [balance, setBalance] = useState<bigint | null>(null);
  const [busy, setBusy] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const owner = useRef(account);
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

  const accept = useCallback((next: AomiCreditCheckout) => {
    setPurchase(next.purchase);
    setMethod(next.purchase.method);
    setCredits(String(next.purchase.amount_microusd / 10_000));
    setNetwork(next.purchase.terms.network ?? "");
    key.current = next.purchase.idempotency_key;
    setWaiting(next.purchase.status === "processing");
  }, []);

  useEffect(() => {
    if (!open) return;
    let active = true;
    if (owner.current !== account) {
      owner.current = account;
      setPurchase(null);
      setWaiting(false);
      setBusy(false);
      setMethods(null);
      key.current = crypto.randomUUID();
      notified.current = null;
    }
    setError(null);
    void Promise.all([
      account.credits.methods(),
      account.credits.purchase("current").catch((e: unknown) => {
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
  }, [open, account, accept]);

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
      void account.credits
        .purchase(purchase.id)
        .then((next) => {
          if (!active) return;
          setPurchase(next.purchase);
          setWaiting(next.purchase.status === "processing");
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
  }, [account, purchase?.id, purchase?.status]);

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
    const next = await account.credits.beginPurchase({
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
    if (owner.current !== account)
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
      accept(await account.credits.cancelPurchase(purchase.id));
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
        accept(await account.credits.purchase("current"));
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
                  <select
                    aria-label="Payment network"
                    value={network}
                    disabled={locked}
                    onChange={(e) => setNetwork(e.target.value)}
                    className="bg-aomi-bg border-aomi-border text-aomi-fg mt-2 w-full rounded-xl border p-3"
                  >
                    {methods?.wallet.networks.map((n) => (
                      <option key={n.network} value={n.network}>
                        {n.name} · native USDC
                      </option>
                    ))}
                  </select>
                </label>
                <p className="text-aomi-muted break-all text-xs">
                  Paying wallet: {wallet.identity.address ?? "Not connected"}
                  <br />
                  Available:{" "}
                  {balance === null
                    ? "—"
                    : (Number(balance) / 1_000_000).toFixed(2)}{" "}
                  USDC
                </p>
                <details className="text-aomi-muted text-xs">
                  <summary>Review treasury details</summary>
                  <p className="mt-2 break-all">
                    Recipient: {selected?.recipient}
                    <br />
                    Native USDC: {selected?.asset}
                  </p>
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
            {purchase?.method === "card" &&
              purchase.status === "awaiting_action" && (
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
