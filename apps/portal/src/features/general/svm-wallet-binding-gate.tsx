"use client";

import { useEffect, useRef, useState } from "react";
import { isUnboundWalletError } from "@aomi-labs/client";
import { useAomiRuntime } from "@aomi-labs/react";
import { Button } from "@aomi-labs/widget-lib";
import { useSvmWalletBinding } from "./use-svm-wallet-binding";

function eventText(payload: unknown): string {
  if (typeof payload === "string") return payload;
  try {
    return JSON.stringify(payload);
  } catch {
    return "";
  }
}

export function SvmWalletBindingGate() {
  const { events, sendMessage } = useAomiRuntime();
  const { bind, binding, canBind, requiresBinding } = useSvmWalletBinding();
  const [visible, setVisible] = useState(false);
  const observedSequence = useRef(0);

  useEffect(() => {
    for (const event of events) {
      if (event.sequence <= observedSequence.current) continue;
      observedSequence.current = event.sequence;
      const payload =
        event.type === "error"
          ? event.message
          : event.type === "tool_complete"
            ? event.result
            : undefined;
      if (requiresBinding && isUnboundWalletError(eventText(payload))) {
        setVisible(true);
      }
    }
  }, [events, requiresBinding]);

  useEffect(() => {
    if (!requiresBinding) setVisible(false);
  }, [requiresBinding]);

  if (!requiresBinding || !visible) return null;

  return (
    <aside className="bg-background border-border absolute bottom-24 right-4 z-50 w-[min(24rem,calc(100%-2rem))] rounded-xl border p-4 shadow-xl">
      <p className="text-sm font-medium">Bind your Solana wallet to continue</p>
      <p className="text-muted-foreground mt-1 text-sm">
        This one-time signature proves the connected wallet belongs to your Aomi
        account. It does not move funds.
      </p>
      <div className="mt-3 flex gap-2">
        <Button
          type="button"
          disabled={!canBind || binding}
          onClick={() => {
            void bind().then((bound) => {
              if (!bound) return;
              setVisible(false);
              void sendMessage(
                "Retry the previous Solana transaction now that the wallet is bound.",
              );
            });
          }}
        >
          {binding ? "Waiting for signature…" : "Bind wallet and retry"}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => setVisible(false)}
        >
          Not now
        </Button>
      </div>
    </aside>
  );
}
