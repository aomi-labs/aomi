"use client";

import { useContext, useMemo } from "react";
import { ListGroup } from "@/ui/aomi/list-group";
import { SectionHeader } from "@/ui/aomi/section-header";
import { useAomiWalletKit } from "@/wallet/context";
import { WalletSignInOptionsContext } from "@/wallet/picker/picker-context";
import { buildWalletChoices, type WalletChoice } from "./wallet-options";
import type { SheetMode } from "./sheet-machine";
import type { SheetFlow } from "./use-sheet-flow";
import type { SheetPurpose } from "./wallet-picker-context";
import { AomiMark } from "@/ui/aomi-mark";
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
  purpose,
}: {
  mode: SheetMode;
  error?: string;
  flow: SheetFlow;
  purpose?: SheetPurpose;
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
  // Adding to a signed-in account can also create a wallet Aomi hosts.
  const agent = mode === "add" && !kit.accountGuest;
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
            : agent
              ? "Create one Aomi hosts, or connect one you own"
              : "Connect another wallet to this account."
        }
        onClose={flow.close}
      />
      <div className="flex min-h-0 flex-col gap-4 overflow-y-auto px-5 pb-5">
        {purpose ? (
          <p
            data-sheet-purpose
            className="rounded-control bg-aomi-surface-2 type-meta text-aomi-muted flex items-center gap-2 px-2.5 py-1.5 [&_svg]:size-4 [&_svg]:shrink-0"
          >
            {purpose.icon}
            {purpose.text}
          </p>
        ) : null}
        {error || flow.error || kit.accountError ? (
          <SheetAlert>{error ?? flow.error ?? kit.accountError}</SheetAlert>
        ) : null}
        {agent ? (
          <section className="flex flex-col gap-2">
            <SectionHeader title="Agent wallet" detail="Hosted by Aomi" />
            <ListGroup>
              <ChoiceRow
                leading={
                  <span
                    aria-hidden
                    className="flex size-8 shrink-0 items-center justify-center"
                  >
                    <AomiMark size={20} className="text-aomi-fg" />
                  </span>
                }
                title="New agent wallet"
                description="EVM + Solana, no extension"
                onClick={flow.newAgentWallet}
              />
            </ListGroup>
          </section>
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
