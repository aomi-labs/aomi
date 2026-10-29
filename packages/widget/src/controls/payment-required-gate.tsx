"use client";

import { useNotification } from "@aomi-labs/react";
import { useShellTransport } from "@/account/transport";
import { testIds } from "@/test-ids";

export function PaymentRequiredGate() {
  const { notifications, dismissNotification } = useNotification();
  // An empty transport origin means this host, including staging and local Chat.
  const topUpOrigin = useShellTransport().baseUrl;
  const paymentNotification = notifications.find(
    (notification) => notification.kind === "payment_required",
  );

  if (!paymentNotification) return null;

  return (
    <div
      className="bg-background/85 absolute inset-0 z-40 flex items-center justify-center px-4 backdrop-blur-sm"
      data-testid={testIds.paygate}
      role="dialog"
      aria-modal="true"
      aria-labelledby="payment-required-title"
    >
      <div className="bg-card border-input max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-3xl border p-7 shadow-2xl md:p-8">
        <div className="space-y-3">
          <h2
            id="payment-required-title"
            className="text-foreground text-2xl font-semibold tracking-normal"
          >
            Add credits to continue
          </h2>
          <p className="text-muted-foreground text-base leading-7">
            You&apos;re out of Aomi credits. Add credits on{" "}
            {topUpOrigin ? new URL(topUpOrigin).host : "this site"} using the same Aomi account, then return
            here and retry.
          </p>
        </div>

        <a
          href={`${topUpOrigin}/?topup=credits`}
          target="_blank"
          rel="noopener noreferrer"
          className="bg-foreground text-background mt-6 flex h-11 items-center justify-center rounded-full px-7 text-sm font-medium"
        >
          Add credits on Aomi
        </a>

        <div className="mt-7 flex justify-end">
          <button type="button" onClick={() => dismissNotification(paymentNotification.id)} className="text-foreground h-11 px-4 text-sm font-medium">
            Not now
          </button>
        </div>
      </div>
    </div>
  );
}
