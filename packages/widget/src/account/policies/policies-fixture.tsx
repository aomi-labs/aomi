"use client";

import { useState } from "react";
import { ArrowUp, Minus } from "lucide-react";
import { BrandMark } from "@/account/account-management/controls";
import { AGENT_WALLET } from "@/account/account-management/wallet-model";
import { AomiButton } from "@/ui/aomi/button";
import { listGroupClass } from "@/ui/aomi/list-group";
import { Segmented } from "@/ui/aomi/segmented";
import {
  PoliciesView,
  WalletPolicyCard,
  WalletPolicySummary,
} from "./policies-view";
import {
  dayFromToday,
  policyAmount,
  type Policy,
  type PolicyCatalog,
  type PolicyChain,
  type PolicyDraft,
  type PolicyProviders,
  type RemovedPolicy,
  type WalletPolicies,
} from "./policy-model";

const OP = { label: "OP", network: "eip155:10" } as const;
const BASE = { label: "Base", network: "eip155:8453" } as const;
const ETH = { label: "Ethereum", network: "eip155:1" } as const;
const SOL = { label: "Solana", network: "solana:mainnet-beta" } as const;

const EXPLORER: Record<string, string> = {
  Ethereum: "https://etherscan.io/token/",
  OP: "https://optimistic.etherscan.io/token/",
  Base: "https://basescan.org/token/",
  Solana: "https://solscan.io/token/",
};
const token = (chain: PolicyChain, address: string, decimals = 6) => ({
  chain,
  asset: `${chain.network}/${chain === SOL ? "token" : "erc20"}:${address}`,
  decimals,
  address,
  explorer: `${EXPLORER[chain.label]}${address}`,
});
const native = (chain: PolicyChain, decimals: number) => ({
  chain,
  asset: `${chain.network}/native`,
  decimals,
});

const PULL_SCOPE = "Total and period on chain";
/** The owner's account, which a signed grant is linked to: nothing deployed. */
const OWNER_ACCOUNT = "0x3e14a1b2c3d4e5f60718293a4b5c6d7e8f906dde";
const ACCOUNT_PAGE: Record<string, string> = {
  [ETH.network]: `https://etherscan.io/address/${OWNER_ACCOUNT}`,
  [OP.network]: `https://optimistic.etherscan.io/address/${OWNER_ACCOUNT}`,
  [BASE.network]: `https://basescan.org/address/${OWNER_ACCOUNT}`,
};
const EVM_APPS = [ETH.network, OP.network, BASE.network];

const CATALOG: PolicyCatalog = {
  tokens: [
    {
      symbol: "USDC",
      chains: [
        token(ETH, "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"),
        token(OP, "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85"),
        token(BASE, "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"),
        token(SOL, "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"),
      ],
    },
    {
      symbol: "USDT",
      chains: [
        token(ETH, "0xdAC17F958D2ee523a2206206994597C13D831ec7"),
        token(OP, "0x94b008aA00579c1307B0EF2c499aD98a8ce58e58"),
        token(SOL, "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB"),
      ],
    },
    { symbol: "SOL", chains: [native(SOL, 9)] },
    {
      symbol: "ETH",
      chains: [native(ETH, 18), native(OP, 18), native(BASE, 18)],
    },
  ],
  apps: [
    { id: "uniswap", label: "Uniswap", chains: EVM_APPS },
    { id: "aave", label: "Aave", chains: EVM_APPS },
    { id: "jupiter", label: "Jupiter", chains: [SOL.network] },
    { id: "kamino", label: "Kamino", chains: [SOL.network] },
    { id: "marinade", label: "Marinade", chains: [SOL.network] },
    { id: "orca", label: "Orca", chains: [SOL.network] },
  ],
};

const PROVIDERS: PolicyProviders = {
  [SOL.network]: { name: "Swig", holds: "total_period_and_destination" },
  // A pull grant: the chain holds the total and the end, not the app.
  [ETH.network]: {
    name: "MetaMask",
    holds: "total_and_period",
    appScope: PULL_SCOPE,
  },
  [OP.network]: {
    name: "MetaMask",
    holds: "total_and_period",
    appScope: PULL_SCOPE,
  },
  [BASE.network]: {
    name: "MetaMask",
    holds: "total_and_period",
    appScope: PULL_SCOPE,
  },
};

type FixtureChange = {
  id: string;
  wallet: string;
  expiresIn: string;
  lines: readonly { text: string; loosens: boolean }[];
  /** The owner must sign in again before deciding. */
  needsSignIn?: boolean;
};

const CHANGES: FixtureChange[] = [
  {
    id: "change-1",
    wallet: "london-test",
    expiresIn: "12 h",
    lines: [{ text: "Up to 199 SOL on Orca (Solana)", loosens: true }],
    needsSignIn: true,
  },
];

const row = (
  policy: Omit<Policy, "ruleIds" | "blocked" | "ended">,
): Policy => ({
  ...policy,
  ruleIds: [policy.id],
  blocked: policy.amount === "0",
  ended: false,
});

const REMOVED_NOTE =
  "This rule was removed or has ended. Sign to take off what the chain holds for it.";
const SEND_NOTE =
  "Your revocation is signed. Send it from your wallet to take the grant off chain, or wait for Aomi to send it where the network supports that.";
/** Policies the owner removed that their provider still holds on chain. */
const REMOVED: RemovedPolicy[] = [
  {
    // A signed grant: taking it off is a revoking signature.
    key: "metamask:eip155:8453:removed-usdc-aave",
    id: "eip155:8453/erc20:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913@protocol:aave",
    symbol: "USDC",
    to: { kind: "app", id: "aave", label: "Aave" },
    chain: BASE,
    enforcement: {
      name: "MetaMask",
      href: ACCOUNT_PAGE[BASE.network],
      deploy: "fixture",
      left: "5 USDC left",
      note: REMOVED_NOTE,
    },
  },
  {
    // A signed grant whose revocation the owner already signed, on a chain
    // Aomi cannot send it on: the one step left is theirs, a plain transaction.
    key: "metamask:eip155:8453:removed-usdc-morpho",
    id: "eip155:8453/erc20:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913@protocol:morpho",
    symbol: "USDC",
    to: { kind: "app", id: "morpho", label: "Morpho" },
    chain: BASE,
    enforcement: {
      name: "MetaMask",
      href: ACCOUNT_PAGE[BASE.network],
      deploy: "fixture",
      send: true,
      left: "3 USDC left",
      note: SEND_NOTE,
    },
  },
  {
    // A Swig role: taking it off is a transaction.
    key: "swig:solana:mainnet-beta:removed-sol-orca",
    id: "solana:mainnet-beta/native@protocol:orca",
    symbol: "SOL",
    to: { kind: "app", id: "orca", label: "Orca" },
    chain: SOL,
    enforcement: {
      name: "Swig",
      href: "https://solscan.io/tx/fixture-policy-deployment",
      deploy: "fixture",
      left: "2.5 SOL left",
      note: REMOVED_NOTE,
    },
  },
];

const WALLETS: WalletPolicies[] = [
  {
    id: "london-test",
    name: "london-test",
    linkedOnly: true,
    onlyListed: true,
    policies: [
      // The backend deploys each rule on its own, so each chain is a row.
      row({
        id: "usdc-any-op",
        symbol: "USDC",
        amount: "1,000",
        to: { kind: "any_app" },
        chains: [OP],
        activeFrom: "2026-11-11",
        activeUntil: "2026-12-11",
        enforcement: {
          name: "MetaMask",
          href: ACCOUNT_PAGE[OP.network],
          left: "640 USDC left",
        },
      }),
      row({
        id: "usdc-any-base",
        symbol: "USDC",
        amount: "1,000",
        to: { kind: "any_app" },
        chains: [BASE],
        activeFrom: "2026-11-11",
        activeUntil: "2026-12-11",
        enforcement: {
          name: "MetaMask",
          href: ACCOUNT_PAGE[BASE.network],
          left: "1,000 USDC left",
          chainEnd: "2026-12-14",
        },
      }),
      row({
        id: "sol-kamino",
        symbol: "SOL",
        amount: "10",
        to: { kind: "app", id: "kamino", label: "Kamino" },
        chains: [SOL],
        activeFrom: "2026-11-18",
        activeUntil: null,
        enforcement: {
          name: "Swig",
          href: "https://solscan.io/tx/fixture-policy-deployment",
          left: "7.2 SOL left",
        },
      }),
      row({
        id: "usdc-uniswap-eth",
        symbol: "USDC",
        amount: "1,000",
        to: { kind: "app", id: "uniswap", label: "Uniswap" },
        chains: [ETH],
        activeFrom: null,
        activeUntil: "2026-12-11",
        enforcement: { name: "MetaMask", deploy: "fixture", scope: PULL_SCOPE },
      }),
      // The same policy on two chains where nothing but Aomi holds it: one row.
      row({
        id: "usdt-any-eth-op",
        symbol: "USDT",
        amount: "500",
        to: { kind: "any_app" },
        chains: [ETH, OP],
        activeFrom: "2026-11-15",
        activeUntil: null,
        enforcement: { name: null },
      }),
      row({
        id: "usdt-block-jupiter",
        symbol: "USDT",
        amount: "0",
        to: { kind: "app", id: "jupiter", label: "Jupiter" },
        chains: [SOL],
        activeFrom: "2026-11-18",
        activeUntil: "2026-11-25",
        enforcement: { name: null },
      }),
      {
        ...row({
          id: "usdc-aave-base",
          symbol: "USDC",
          amount: "250",
          to: { kind: "app", id: "aave", label: "Aave" },
          chains: [BASE],
          activeFrom: "2026-10-01",
          activeUntil: "2026-10-31",
          enforcement: { name: null },
        }),
        ended: true,
      },
    ],
    removed: REMOVED,
    authority: {
      kind: "wallet",
      family: "EVM",
      address: "0x3e14a1b2c3d4e5f60718293a4b5c6d7e8f906dde",
    },
    authorityWallets: [
      {
        brand: "para",
        address: "0x3e14a1b2c3d4e5f60718293a4b5c6d7e8f906dde",
        login: "you@example.com",
        family: "EVM",
      },
      {
        brand: "para",
        address: "HJ5qEHk4mVQyS7cT2uWb9xZr1nPdL8aFhoMG",
        login: "you@example.com",
        family: "SVM",
      },
    ],
  },
  {
    id: "trading-bot",
    name: "trading-bot",
    linkedOnly: false,
    onlyListed: false,
    policies: [],
    authority: { kind: "aomi" },
    authorityWallets: [],
  },
];

/**
 * A draft as rows: a provider deploys each rule on its own, so each chain it
 * holds gets a row; the chains only Aomi holds share one. A provider-held
 * policy starts when its deployment is signed.
 */
function draftPolicies(draft: PolicyDraft, onlyListed: boolean): Policy[] {
  const providerOf = (network: string) =>
    onlyListed ? (PROVIDERS[network]?.name ?? null) : null;
  const picked = draft.chains.map((entry) => entry.chain);
  const aomi = picked.filter((chain) => !providerOf(chain.network));
  const groups = [
    ...picked
      .filter((chain) => providerOf(chain.network))
      .map((chain) => [chain]),
    ...(aomi.length ? [aomi] : []),
  ];
  return groups.map((chains) => {
    const name = providerOf(chains[0]!.network);
    const id = `${draft.symbol}:${chains[0]!.label}:${Date.now()}`;
    return row({
      id,
      symbol: draft.symbol,
      amount: policyAmount(Number(draft.amount)),
      to: draft.to,
      chains,
      activeFrom: name ? null : dayFromToday(0),
      activeUntil: draft.activeUntil,
      enforcement: name
        ? {
            name,
            deploy: "fixture",
            scope:
              draft.to.kind === "address"
                ? undefined
                : PROVIDERS[chains[0]!.network]?.appScope,
          }
        : { name: null },
    });
  });
}

/** The fixture's stand-in for the real change card: it decides nothing. */
function FixtureChangeCard({
  change,
  onDecide,
}: {
  change: FixtureChange;
  onDecide: () => void;
}) {
  return (
    <section
      aria-label={`Policy change for ${change.wallet}`}
      data-policy-change={change.id}
      className={`${listGroupClass} flex flex-col gap-3 p-3.5`}
    >
      <div className="flex items-baseline justify-between gap-3">
        <h4 className="type-row min-w-0 truncate">
          Policy change · {change.wallet}
        </h4>
        <span className="type-meta text-aomi-muted shrink-0">
          expires in {change.expiresIn}
        </span>
      </div>
      <ul className="type-control flex flex-col gap-1.5">
        {change.lines.map((line, index) => (
          <li key={index} className="flex items-start gap-2">
            {line.loosens ? (
              <ArrowUp
                aria-label="Gives the agent more"
                className="text-aomi-danger mt-0.5 size-4 shrink-0"
              />
            ) : (
              <Minus
                aria-hidden
                className="text-aomi-muted mt-0.5 size-4 shrink-0"
              />
            )}
            <span className={line.loosens ? "text-aomi-danger" : undefined}>
              {line.text}
            </span>
          </li>
        ))}
      </ul>
      {change.needsSignIn ? (
        <div
          role="alert"
          className="rounded-control bg-aomi-warning/15 type-meta flex items-center justify-between gap-3 px-3 py-2"
        >
          <span>For a policy change, sign in again.</span>
          <AomiButton size="sm">Sign in again</AomiButton>
        </div>
      ) : null}
      <div className="flex items-center gap-2">
        <AomiButton variant="ghost" size="sm" onClick={onDecide}>
          Later
        </AomiButton>
        <span className="flex-1" />
        <AomiButton size="sm" onClick={onDecide}>
          Decline
        </AomiButton>
        <AomiButton
          variant="primary"
          size="sm"
          disabled={change.needsSignIn}
          onClick={onDecide}
        >
          Approve
        </AomiButton>
      </div>
    </section>
  );
}

type Screen = "wallet" | "policies";

/**
 * The Policies tab and the agent wallet popup's summary on sample data, at
 * `/dev/policies`. It feeds the same components Settings › Policies does;
 * nothing here reads or writes the backend, and edits live in memory.
 */
export function PoliciesFixture() {
  const [screen, setScreen] = useState<Screen>("policies");
  const [changes, setChanges] = useState(CHANGES);
  const [wallets, setWallets] = useState(WALLETS);
  const [epoch, setEpoch] = useState(0);
  const first = wallets[0]!;
  const write = (
    id: string,
    next: (held: WalletPolicies) => WalletPolicies,
  ) => {
    setWallets((held) =>
      held.map((wallet) => (wallet.id === id ? next(wallet) : wallet)),
    );
    setEpoch((count) => count + 1);
  };
  return (
    <main
      data-policies-fixture
      className="bg-aomi-bg text-aomi-fg flex h-dvh flex-col items-center gap-5 overflow-y-auto px-4 py-8"
    >
      <div className="flex w-full max-w-[640px] flex-wrap items-center justify-between gap-3">
        <p className="type-meta text-aomi-muted">
          Policies fixture · sample data, nothing is saved
        </p>
        <Segmented
          label="Screen"
          size="sm"
          value={screen}
          onChange={setScreen}
          options={[
            { value: "wallet", label: "Wallet popup" },
            { value: "policies", label: "Policies tab" },
          ]}
        />
      </div>

      {screen === "wallet" ? (
        <section
          aria-label="Agent wallet"
          className={`${listGroupClass} flex w-full max-w-[440px] flex-col gap-3 rounded-[20px] p-5`}
        >
          <header className="flex items-start gap-3">
            <BrandMark brand={AGENT_WALLET} dot="on" />
            <div className="min-w-0 flex-1">
              <h1 className="type-title">{first.name}</h1>
              <p className="type-meta text-aomi-muted mt-1">
                Agent wallet · not used yet
              </p>
            </div>
          </header>
          <WalletPolicySummary
            connections={3}
            policies={first.policies.filter((policy) => !policy.ended).length}
            onConnections={() => undefined}
            onPolicies={() => setScreen("policies")}
          />
        </section>
      ) : (
        <div className="w-full max-w-[640px]">
          <PoliciesView
            changes={
              changes.length
                ? changes.map((change) => (
                    <FixtureChangeCard
                      key={change.id}
                      change={change}
                      onDecide={() =>
                        setChanges((held) =>
                          held.filter((entry) => entry.id !== change.id),
                        )
                      }
                    />
                  ))
                : undefined
            }
          >
            {wallets.map((wallet) => (
              <WalletPolicyCard
                key={wallet.id}
                wallet={wallet}
                catalog={CATALOG}
                providers={PROVIDERS}
                epoch={epoch}
                onLinkedOnly={(linkedOnly) =>
                  write(wallet.id, (held) => ({ ...held, linkedOnly }))
                }
                onOnlyListed={(onlyListed) =>
                  write(wallet.id, (held) => ({ ...held, onlyListed }))
                }
                onAdd={(draft) =>
                  write(wallet.id, (held) => ({
                    ...held,
                    policies: [
                      ...draftPolicies(draft, held.onlyListed),
                      ...held.policies,
                    ],
                  }))
                }
                onRemove={(policy) =>
                  write(wallet.id, (held) => ({
                    ...held,
                    policies: held.policies.filter(
                      (entry) => entry.id !== policy.id,
                    ),
                  }))
                }
                onAuthority={(authority) =>
                  write(wallet.id, (held) => ({ ...held, authority }))
                }
                takeOff={(policy) => ({
                  // The chain no longer holds it: the row goes.
                  run: () =>
                    write(wallet.id, (held) => ({
                      ...held,
                      removed: (held.removed ?? []).filter(
                        (entry) => entry.key !== policy.key,
                      ),
                    })),
                })}
                deploy={(policy) => ({
                  // Signing puts it on chain: the row gains its link and start.
                  run: () =>
                    write(wallet.id, (held) => ({
                      ...held,
                      policies: held.policies.map((entry) =>
                        entry.id === policy.id
                          ? {
                              ...entry,
                              enforcement: {
                                name: entry.enforcement.name,
                                scope: entry.enforcement.scope,
                                href: ACCOUNT_PAGE[entry.chains[0]!.network],
                                left: `${entry.amount} ${entry.symbol} left`,
                              },
                              activeFrom: dayFromToday(0),
                            }
                          : entry,
                      ),
                    })),
                })}
              />
            ))}
          </PoliciesView>
        </div>
      )}
    </main>
  );
}
