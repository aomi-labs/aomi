"use client";

import { lazy, Suspense, useContext, useEffect } from "react";
import { AomiSheet } from "@/ui/aomi/aomi-sheet";
import { useWalletPicker } from "./wallet-picker-context";
import { WalletSignInOptionsContext } from "@/wallet/picker/picker-context";
import { ChooseStep } from "./choose-step";
import { ChainStep, WalletStep } from "./wallet-step";
import { MergeStep } from "./merge-step";

// Only "Add a wallet" opens it, so it loads only then.
const NewAgentWalletStep = lazy(() =>
  import("@/account/agent-wallets/new-agent-wallet").then((module) => ({
    default: module.NewAgentWalletStep,
  })),
);

/** The wallet sheet: sign in, add a wallet, verify, switch, merge. */
export function WalletPicker({ backdrop }: { backdrop?: boolean } = {}) {
  const { sheet, flow, open, purpose } = useWalletPicker();
  const hostOptions = useContext(WalletSignInOptionsContext);

  // Warm the provider SDKs as the sheet opens, so a click can open login at once.
  useEffect(() => {
    if (open) for (const option of hostOptions) option.preload?.();
  }, [hostOptions, open]);

  if (sheet.step === "closed") return null;

  return (
    <AomiSheet onClose={flow.close} backdrop={backdrop}>
      {sheet.step === "choose" ? (
        <ChooseStep
          mode={sheet.mode}
          error={sheet.error}
          flow={flow}
          purpose={sheet.mode === "sign-in" ? purpose : undefined}
        />
      ) : sheet.step === "chain" ? (
        <ChainStep brand={sheet.brand} flow={flow} />
      ) : sheet.step === "agent" ? (
        <Suspense fallback={null}>
          <NewAgentWalletStep onDone={flow.close} onClose={flow.close} />
        </Suspense>
      ) : sheet.step === "merge" ? (
        <MergeStep sheet={sheet} flow={flow} />
      ) : (
        <WalletStep sheet={sheet} flow={flow} />
      )}
    </AomiSheet>
  );
}
