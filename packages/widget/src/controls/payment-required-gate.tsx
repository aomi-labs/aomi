"use client";

import { useNotification } from "@aomi-labs/react";
import { Wallet } from "lucide-react";
import { useShellTransport } from "@/account/transport";
import { useAccountCredits } from "@/account/use-account-credits";
import {
  billingFromPosition,
  formatDollars,
} from "@/account/usage/credits/format";
import { AllowanceRing } from "@/ui/aomi/allowance-ring";
import { AomiButton, aomiButton } from "@/ui/aomi/button";
import { testIds } from "@/test-ids";

export function PaymentRequiredGate() {
  const { notifications, dismissNotification } = useNotification();
  // An empty transport origin means this host, including staging and local Chat.
  const topUpOrigin = useShellTransport().baseUrl;
  const billing = billingFromPosition(useAccountCredits().data);
  const paymentNotification = notifications.find(
    (notification) => notification.kind === "payment_required",
  );

  if (!paymentNotification) return null;

  return (
    <div
      className="bg-aomi-bg/85 absolute inset-0 z-40 flex items-center justify-center px-4 backdrop-blur-sm"
      data-testid={testIds.paygate}
      role="dialog"
      aria-modal="true"
      aria-labelledby="payment-required-title"
    >
      <div className="border-aomi-overlay-border bg-aomi-raised rounded-shell shadow-modal max-h-[90vh] w-full max-w-[420px] overflow-y-auto border">
        <div className="flex flex-col gap-4 px-6 pb-5 pt-6">
          <div>
            <h2 id="payment-required-title" className="type-title">
              You’ve used this month’s allowance
            </h2>
            <p className="text-aomi-muted mt-1.5 text-[13px] leading-[19px]">
              Add funds to finish this task
              {billing ? `. Your allowance refills on ${billing.resetsOn}` : ""}
              . Funds are added on{" "}
              {topUpOrigin ? new URL(topUpOrigin).host : "this site"} with the
              same Aomi account.
            </p>
          </div>
          {billing ? (
            <div className="border-aomi-border rounded-card divide-aomi-border divide-y border">
              <div className="flex items-center gap-3.5 px-3.5 py-3">
                <AllowanceRing left={billing.allowanceLeft} size={40} />
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-medium">
                    Monthly allowance
                  </div>
                  <div className="type-meta text-aomi-muted">
                    Resets {billing.resetsOn}
                  </div>
                </div>
                <span className="text-[13px] font-medium tabular-nums">
                  {formatDollars(billing.allowanceLeftUsd)}{" "}
                  <span className="text-aomi-muted font-normal">
                    of {formatDollars(billing.allowanceUsd)}
                  </span>
                </span>
              </div>
              <div className="flex items-center gap-3.5 px-3.5 py-3">
                <span className="bg-aomi-surface-2 text-aomi-muted flex size-10 shrink-0 items-center justify-center rounded-full">
                  <Wallet className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-medium">Added balance</div>
                  <div className="type-meta text-aomi-muted">Never expires</div>
                </div>
                <span className="text-[13px] font-medium tabular-nums">
                  {formatDollars(billing.balanceUsd)}
                </span>
              </div>
            </div>
          ) : null}
        </div>
        <div className="border-aomi-border flex justify-end gap-2 border-t px-6 py-3.5">
          <AomiButton
            variant="ghost"
            className="h-9"
            onClick={() => dismissNotification(paymentNotification.id)}
          >
            Not now
          </AomiButton>
          <a
            href={`${topUpOrigin}/?topup=credits`}
            target="_blank"
            rel="noopener noreferrer"
            className={aomiButton({ variant: "primary", className: "h-9" })}
          >
            Add funds
          </a>
        </div>
      </div>
    </div>
  );
}
