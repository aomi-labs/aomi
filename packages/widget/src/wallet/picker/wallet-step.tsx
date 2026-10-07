"use client";

import { AomiButton } from "@/ui/aomi/button";
import { ListGroup } from "@/ui/aomi/list-group";
import { useAomiWalletKit } from "@/wallet/context";
import { shortAddress } from "@aomi-labs/client";
import type { SheetState, SheetTarget } from "./sheet-machine";
import type { SheetFlow } from "./use-sheet-flow";
import {
  AddressChip,
  BrandMark,
  ChoiceRow,
  FootnoteLink,
  SheetAlert,
  SheetFootnote,
  SheetHeader,
  WaitingButton,
} from "./sheet-parts";

/** Phantom and other two-chain wallets: one row in the list, the chain after. */
export function ChainStep({ brand, flow }: { brand: string; flow: SheetFlow }) {
  return (
    <>
      <SheetHeader
        leading={<BrandMark brand={brand} />}
        title={brand}
        description="Which network do you want to use?"
        onClose={flow.close}
      />
      <div className="flex flex-col gap-4 px-5 pb-5">
        <ListGroup>
          <ChoiceRow
            title="EVM"
            description="Ethereum, Base, Arbitrum and other EVM chains"
            onClick={() => flow.pickChain("evm")}
          />
          <ChoiceRow
            title="SVM"
            description="Solana"
            onClick={() => flow.pickChain("svm")}
          />
        </ListGroup>
        <SheetFootnote>
          You can add the other network later from Settings.
        </SheetFootnote>
      </div>
    </>
  );
}

type WalletStepState = Extract<
  SheetState,
  { step: "connecting" | "signing" | "verify" | "detected" | "switch" }
>;

/**
 * One wallet, one address, one thing to do: approve in the app, sign, verify
 * a new address, or switch accounts inside the app.
 */
export function WalletStep({
  sheet,
  flow,
}: {
  sheet: WalletStepState;
  flow: SheetFlow;
}) {
  const kit = useAomiWalletKit();
  const target: SheetTarget | undefined =
    sheet.step === "connecting" ? sheet.expected : sheet.target;
  const brand =
    (sheet.step === "connecting" ? sheet.brand : target?.brand) ??
    "your wallet";
  const signedIn = Boolean(kit.accountUser);
  const useAnother = (
    <FootnoteLink onClick={flow.back}>Use another wallet</FootnoteLink>
  );
  const content = (() => {
    switch (sheet.step) {
      case "connecting":
        return {
          title: `Check ${brand}`,
          description: `Approve the connection in ${brand}.`,
          action: <WaitingButton>Waiting for {brand}…</WaitingButton>,
          footnote: useAnother,
        };
      case "signing":
        return {
          title: `Check ${brand}`,
          description: signedIn
            ? "Sign the message to add this address to your account."
            : "Sign the message to finish signing in.",
          action: <WaitingButton>Waiting for signature…</WaitingButton>,
          footnote: (
            <>
              Closed the prompt?{" "}
              <FootnoteLink onClick={() => void flow.sign(sheet.target)}>
                Sign again
              </FootnoteLink>{" "}
              · {useAnother}
            </>
          ),
        };
      case "verify":
        return {
          title: `Check ${brand}`,
          description: signedIn
            ? "Sign the message to add this address to your account."
            : "Sign the message to finish signing in.",
          error: sheet.error,
          action: (
            <AomiButton
              variant="primary"
              className="h-10 w-full"
              onClick={() => void flow.sign(sheet.target)}
            >
              Sign message
            </AomiButton>
          ),
          footnote: useAnother,
        };
      case "detected":
        return {
          title: `New address in ${brand}`,
          description: `${brand} switched to an address that isn’t in your account yet.`,
          action: (
            <div className="flex flex-col gap-2">
              <AomiButton
                variant="primary"
                className="h-10 w-full"
                onClick={() => void flow.sign(sheet.target)}
              >
                Verify and add to account
              </AomiButton>
              <AomiButton className="h-10 w-full" onClick={flow.notNow}>
                Not now
              </AomiButton>
            </div>
          ),
          footnote: sheet.previous
            ? `Until you verify, Aomi keeps using ${shortAddress(sheet.previous)}. Switch back in ${brand} to sign with it.`
            : undefined,
        };
      case "switch":
        return {
          title: `Switch to ${shortAddress(sheet.target.address)}`,
          description: `Open ${brand} and choose this account.`,
          action: <WaitingButton>Waiting for {brand}…</WaitingButton>,
          footnote: `${brand} shows Aomi one account at a time. We’ll pick it up as soon as you switch. No signature needed.`,
        };
    }
  })();

  return (
    <>
      <SheetHeader
        title={content.title}
        description={content.description}
        onClose={flow.close}
      />
      <div className="flex flex-col items-center gap-4 px-5 pb-5">
        <BrandMark brand={target?.brand ?? brand} size={36} />
        {target ? <AddressChip address={target.address} /> : null}
        {"error" in content && content.error ? (
          <div className="w-full">
            <SheetAlert>{content.error}</SheetAlert>
          </div>
        ) : null}
        <div className="w-full">{content.action}</div>
        {content.footnote ? (
          <SheetFootnote>{content.footnote}</SheetFootnote>
        ) : null}
      </div>
    </>
  );
}
