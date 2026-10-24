"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Elements,
  ExpressCheckoutElement,
  PaymentElement,
  useElements,
  useStripe,
} from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";
import type { StripeExpressCheckoutElementConfirmEvent } from "@stripe/stripe-js";
import type { AomiFundingResult } from "@aomi-labs/client";

export default function CardForm(props: {
  publicKey: string;
  amount: number;
  disabled: boolean;
  begin: () => Promise<AomiFundingResult>;
  completed: () => void;
  failed: (message: string) => void;
  onBusy: (busy: boolean) => void;
}) {
  const stripe = useMemo(() => loadStripe(props.publicKey), [props.publicKey]);
  const container = useRef<HTMLDivElement>(null);
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const root = container.current;
    if (!root) return;
    const syncTheme = () =>
      setDark(
        root.closest(".light, .dark")?.classList.contains("dark") ?? false,
      );
    syncTheme();
    const observer = new MutationObserver(syncTheme);
    for (
      let ancestor = root.parentElement;
      ancestor;
      ancestor = ancestor.parentElement
    )
      observer.observe(ancestor, {
        attributes: true,
        attributeFilter: ["class"],
      });
    return () => observer.disconnect();
  }, []);
  return (
    <div ref={container}>
      <Elements
        stripe={stripe}
        options={{
          mode: "payment",
          amount: props.amount / 10_000,
          currency: "usd",
          allowedPaymentMethodTypes: ["card", "link"],
          appearance: {
            theme: dark ? "night" : "stripe",
            variables: { borderRadius: "12px" },
          },
        }}
      >
        <Form {...props} />
      </Elements>
    </div>
  );
}

function Form({
  amount,
  disabled,
  begin,
  completed,
  failed,
  onBusy,
}: Omit<Parameters<typeof CardForm>[0], "publicKey">) {
  const stripe = useStripe();
  const elements = useElements();
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [express, setExpress] = useState<boolean | null>(null);
  async function pay(event?: StripeExpressCheckoutElementConfirmEvent) {
    if (!stripe || !elements || busy || disabled) {
      event?.paymentFailed({ reason: "fail" });
      return;
    }
    setBusy(true);
    onBusy(true);
    try {
      const submitted = await elements.submit();
      if (submitted.error)
        throw new Error(
          submitted.error.message ?? "Check your payment details.",
        );
      const checkout = await begin();
      if (checkout.action.kind === "done") {
        completed();
        return;
      }
      if (checkout.action.kind !== "confirm_card") {
        completed();
        return;
      }
      const result = await stripe.confirmPayment({
        elements,
        clientSecret: checkout.action.client_secret,
        confirmParams: { return_url: window.location.href },
        redirect: "if_required",
      });
      if (result.error)
        throw new Error(
          result.error.message ??
            "Payment could not be completed. Try another card.",
        );
      completed();
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Payment could not be completed.";
      event?.paymentFailed({ reason: "fail", message });
      failed(message);
    } finally {
      setBusy(false);
      onBusy(false);
    }
  }
  return (
    <div className="flex flex-col gap-4">
      <div hidden={express === false}>
        <ExpressCheckoutElement
          options={{
            layout: { maxColumns: 1 },
            paymentMethods: {
              applePay: "auto",
              link: "auto",
              googlePay: "never",
              amazonPay: "never",
              paypal: "never",
              klarna: "never",
            },
          }}
          onReady={(event) =>
            setExpress(
              Boolean(
                event.availablePaymentMethods?.applePay ||
                event.availablePaymentMethods?.link,
              ),
            )
          }
          onConfirm={(event) => void pay(event)}
        />
      </div>
      {express && (
        <p className="text-aomi-muted text-center text-xs">or pay by card</p>
      )}
      {!ready && (
        <p role="status" className="text-aomi-muted text-xs">
          Loading secure card fields…
        </p>
      )}
      <PaymentElement
        onReady={() => setReady(true)}
        onLoadError={() =>
          failed(
            "Secure card fields could not load. Check your connection and reopen checkout.",
          )
        }
        options={{
          layout: "tabs",
          wallets: { applePay: "never", googlePay: "never" },
        }}
      />
      <button
        className="bg-aomi-fg text-aomi-bg rounded-xl px-4 py-3 font-medium disabled:opacity-40"
        disabled={!stripe || !ready || busy || disabled}
        onClick={() => void pay()}
      >
        {busy
          ? "Confirming payment…"
          : `Pay $${(amount / 1_000_000).toFixed(2)}`}
      </button>
    </div>
  );
}
