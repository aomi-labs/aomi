"use client";

import { useContext, useMemo } from "react";
import { ListGroup } from "@/ui/aomi/list-group";
import { SectionHeader } from "@/ui/aomi/section-header";
import { useAomiWalletKit } from "@/wallet/context";
import { WalletSignInOptionsContext } from "./sign-in-options";
import { buildWalletChoices, type WalletChoice } from "./wallet-options";
import type { SheetMode } from "./sheet-machine";
import type { SheetFlow } from "./use-sheet-flow";
import {
  BrandMark,
  ChoiceRow,
  SheetAlert,
  SheetFootnote,
  SheetHeader,
} from "./sheet-parts";

/** Social sign-in, then the wallets in this browser, then other ways to connect. */
export function ChooseStep({
  mode,
  error,
  flow,
}: {
  mode: SheetMode;
  error?: string;
  flow: SheetFlow;
}) {
  const kit = useAomiWalletKit();
  const hostOptions = useContext(WalletSignInOptionsContext);
  const choices = useMemo(() => buildWalletChoices(kit), [kit]);
  const linkedProviders = new Set(
    (kit.accountLinkedAccounts ?? []).map((linked) =>
      linked.provider.toLowerCase(),
    ),
  );
  // Without host choices, the active provider's own methods (Google, email…).
  const social = hostOptions.length
    ? hostOptions
        .filter((option) => !linkedProviders.has(option.id.toLowerCase()))
        .map((option) => ({
          id: option.id,
          label: option.label,
          description: option.description,
          brand: option.id,
          connect: option.connect,
          preload: option.preload,
        }))
    : (kit.socialLoginOptions ?? []).map((option) => ({
        id: option.id,
        label: option.label,
        description: option.description,
        brand: kit.identity.sessionProvider,
        connect: () => kit.connectSocial?.(option.id) ?? Promise.resolve(),
        preload: undefined,
      }));
  const detected = choices.filter((choice) => choice.section === "detected");
  const more = choices.filter((choice) => choice.section === "more");
  const walletRow = (choice: WalletChoice) => (
    <ChoiceRow
      key={choice.id}
      leading={<BrandMark brand={choice.id} iconUrl={choice.iconUrl} />}
      title={choice.label}
      description={choice.description}
      onClick={() => flow.pick(choice)}
    />
  );

  return (
    <>
      <SheetHeader
        title={mode === "sign-in" ? "Sign in to Aomi" : "Add a wallet"}
        description={
          mode === "sign-in"
            ? "Your chats follow your account on any device."
            : "Connect another wallet to this account."
        }
        onClose={flow.close}
      />
      <div className="flex min-h-0 flex-col gap-4 overflow-y-auto px-5 pb-5">
        {error || flow.error || kit.accountError ? (
          <SheetAlert>{error ?? flow.error ?? kit.accountError}</SheetAlert>
        ) : null}
        {social.length ? (
          <section className="flex flex-col gap-2">
            <SectionHeader
              title="Social sign-in"
              detail="Email or social account"
            />
            <ListGroup>
              {social.map((option) => (
                <ChoiceRow
                  key={option.id}
                  leading={<BrandMark brand={option.brand ?? option.id} />}
                  title={option.label}
                  description={option.description}
                  disabled={flow.busy}
                  onPointerEnter={option.preload}
                  onClick={() => void flow.pickSocial(option.connect)}
                />
              ))}
            </ListGroup>
          </section>
        ) : null}
        {detected.length ? (
          <section className="flex flex-col gap-2">
            <SectionHeader title="Wallets" detail="Detected in this browser" />
            <ListGroup>{detected.map(walletRow)}</ListGroup>
          </section>
        ) : null}
        {more.length ? (
          <section className="flex flex-col gap-2">
            <SectionHeader
              title={detected.length ? "More wallets" : "Wallets"}
            />
            <ListGroup>{more.map(walletRow)}</ListGroup>
          </section>
        ) : null}
        <SheetFootnote>
          You’ll sign a message to prove the wallet is yours. No transaction is
          sent.
        </SheetFootnote>
      </div>
    </>
  );
}
