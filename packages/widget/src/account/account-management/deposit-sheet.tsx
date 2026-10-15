"use client";

import { useEffect, useMemo, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { encode } from "uqr";
import { getAddress } from "viem";
import { cn } from "@aomi-labs/react";
import type {
  AomiAccountWallet,
  AomiClient,
  AomiWalletChainBalance,
} from "@aomi-labs/client";
import { AomiButton } from "@/ui/aomi/button";
import { useWidgetOverlay } from "@/ui/widget-scope";
import { CopyButton } from "./controls";
import { useWalletBalance } from "./use-agent-wallets";

/** How often an open sheet re-reads the balance. */
const POLL_MS = 15_000;
const BASE = 8453;

/** One place to send funds: a chain of one wallet. */
export type DepositTarget = {
  key: string;
  wallet: AomiAccountWallet;
  name: string;
  nativeSymbol: string;
  /** EVM chain id; absent for Solana. */
  chainId?: number;
};

/** `ethereum:<checksummed>@<chainId>` (EIP-681) or `solana:<address>`. */
export function depositUri(target: DepositTarget): string {
  return target.chainId === undefined
    ? `solana:${target.wallet.address}`
    : `ethereum:${getAddress(target.wallet.address)}@${target.chainId}`;
}

export function depositWarning(target: DepositTarget): string {
  return `Send only on ${target.name}. Add about $2 of ${target.nativeSymbol} for gas: the wallet pays its own gas for now.`;
}

/**
 * The tabs: the EVM wallet's chains from its balance (Base first), then
 * Solana when there is a Solana agent wallet.
 */
export function depositTargets(input: {
  evm?: AomiAccountWallet;
  svm?: AomiAccountWallet;
  chains?: readonly AomiWalletChainBalance[];
}): DepositTarget[] {
  const targets: DepositTarget[] = [];
  if (input.evm) {
    const evm = input.evm;
    const chains = (input.chains ?? [])
      .map((chain) => ({ chain, id: Number(chain.chain) }))
      .filter(({ id }) => Number.isSafeInteger(id) && id > 0);
    const listed = chains.length
      ? chains
      : [{ id: BASE, chain: { name: "Base", native_symbol: "ETH" } }];
    listed.sort((a, b) => Number(b.id === BASE) - Number(a.id === BASE));
    for (const { chain, id } of listed)
      targets.push({
        key: `evm:${id}`,
        wallet: evm,
        name: chain.name,
        nativeSymbol: chain.native_symbol || "ETH",
        chainId: id,
      });
  }
  if (input.svm)
    targets.push({
      key: "svm",
      wallet: input.svm,
      name: "Solana",
      nativeSymbol: "SOL",
    });
  return targets;
}

/**
 * Deposit to an agent wallet: a chain tab, a QR code of the payment URI,
 * the full address, and what to send. Polls the balance while open.
 */
export function DepositSheet({
  wallet,
  companion,
  client,
  onClose,
}: {
  wallet: AomiAccountWallet;
  /** The client Settings reads the account through. */
  client?: AomiClient;
  /** The other family's default agent wallet, shown as its own tab. */
  companion?: AomiAccountWallet;
  onClose: () => void;
}) {
  const container = useWidgetOverlay();
  const evm = wallet.family === "evm" ? wallet : companion;
  const svm = wallet.family === "svm" ? wallet : companion;
  const evmBalance = useWalletBalance(client, evm?.id);
  const svmBalance = useWalletBalance(client, svm?.id);
  const targets = useMemo(
    () => depositTargets({ evm, svm, chains: evmBalance.data?.chains }),
    [evm, svm, evmBalance.data?.chains],
  );
  const [selected, setSelected] = useState<string>();
  const target =
    targets.find((candidate) => candidate.key === selected) ??
    (wallet.family === "svm"
      ? targets.find((candidate) => candidate.key === "svm")
      : undefined) ??
    targets[0]!;

  const refetchEvm = evmBalance.refetch;
  const refetchSvm = svmBalance.refetch;
  const pollEvm = Boolean(evm);
  const pollSvm = Boolean(svm);
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (pollEvm) void refetchEvm();
      if (pollSvm) void refetchSvm();
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [pollEvm, pollSvm, refetchEvm, refetchSvm]);

  const address =
    target.chainId === undefined
      ? target.wallet.address
      : getAddress(target.wallet.address);
  const chainBalance =
    target.chainId === undefined
      ? svmBalance.data?.chains[0]
      : evmBalance.data?.chains.find(
          (chain) => Number(chain.chain) === target.chainId,
        );

  return (
    <Dialog.Root open onOpenChange={(open) => (open ? undefined : onClose())}>
      <Dialog.Portal container={container}>
        <Dialog.Overlay className="fixed inset-0 z-[80] bg-black/40 backdrop-blur-[3px]" />
        <Dialog.Content
          data-deposit-sheet
          className="border-aomi-border bg-aomi-raised text-aomi-fg rounded-shell shadow-modal fixed left-1/2 top-1/2 z-[81] max-h-[calc(100vh-2rem)] w-[calc(100%-2rem)] max-w-[420px] -translate-x-1/2 -translate-y-1/2 overflow-y-auto border p-5 focus:outline-none"
        >
          <Dialog.Title className="type-title">
            Deposit to {target.wallet.label}
          </Dialog.Title>
          <Dialog.Description className="type-control text-aomi-muted mt-1.5">
            Funds Aomi can trade with on your behalf
          </Dialog.Description>

          {targets.length > 1 ? (
            <div
              role="tablist"
              aria-label="Network"
              className="-mx-1 mt-4 flex gap-1.5 overflow-x-auto px-1 pb-1"
            >
              {targets.map((candidate) => {
                const on = candidate.key === target.key;
                return (
                  <button
                    key={candidate.key}
                    type="button"
                    role="tab"
                    aria-selected={on}
                    onClick={() => setSelected(candidate.key)}
                    className={cn(
                      "type-control rounded-control focus-visible:ring-aomi-accent-strong/40 h-7 shrink-0 border px-2.5 outline-none transition-colors focus-visible:ring-2",
                      on
                        ? "border-aomi-fg/20 bg-aomi-surface-2 text-aomi-fg font-medium"
                        : "border-aomi-border text-aomi-muted hover:bg-aomi-hover hover:text-aomi-fg",
                    )}
                  >
                    {candidate.name}
                  </button>
                );
              })}
            </div>
          ) : null}

          <div className="mt-4 flex justify-center">
            <QrCode
              value={depositUri(target)}
              label={`QR code for ${target.wallet.address} on ${target.name}`}
            />
          </div>

          <div className="border-aomi-border bg-aomi-bg rounded-control mt-4 flex items-start gap-2 border py-2 pl-3 pr-1.5">
            <span
              data-deposit-address
              className="type-address min-w-0 flex-1 select-all break-all pt-1"
            >
              {address}
            </span>
            <CopyButton value={address} label={`Copy address ${address}`} />
          </div>

          <p
            data-deposit-warning
            className="type-meta mt-3 rounded-[8px] bg-[color-mix(in_srgb,var(--aomi-warning)_10%,transparent)] px-3 py-2 text-[color-mix(in_srgb,var(--aomi-warning)_62%,var(--aomi-fg))]"
          >
            {depositWarning(target)}
          </p>

          <p data-deposit-balance className="type-meta text-aomi-muted mt-3">
            {chainBalanceLine(target, chainBalance)}
          </p>

          <div className="mt-5 flex justify-end">
            <Dialog.Close asChild>
              <AomiButton variant="ghost">Done</AomiButton>
            </Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** What this wallet holds on the selected chain, as of the last read. */
export function chainBalanceLine(
  target: DepositTarget,
  chain?: AomiWalletChainBalance,
): string {
  if (!chain) return `Checking ${target.name}…`;
  if (chain.error) return `Couldn’t read ${target.name} right now.`;
  const parts = [
    ...(chain.native && Number(chain.native.amount) > 0
      ? [`${chain.native.amount} ${chain.native_symbol || target.nativeSymbol}`]
      : []),
    ...chain.tokens
      .filter((token) => Number(token.amount) > 0)
      .map((token) => `${token.amount} ${token.symbol}`),
  ];
  return parts.length
    ? `On ${target.name}: ${parts.join(" · ")}`
    : `Nothing on ${target.name} yet. This updates every 15 seconds.`;
}

/** A QR code drawn as one SVG path; dark modules on white for any scanner. */
function QrCode({ value, label }: { value: string; label: string }) {
  const { path, size } = useMemo(() => {
    const qr = encode(value, { ecc: "M", border: 2 });
    let d = "";
    qr.data.forEach((row, y) =>
      row.forEach((dark, x) => {
        if (dark) d += `M${x} ${y}h1v1h-1z`;
      }),
    );
    return { path: d, size: qr.size };
  }, [value]);
  return (
    <svg
      role="img"
      aria-label={label}
      data-qr={value}
      viewBox={`0 0 ${size} ${size}`}
      width={184}
      height={184}
      shapeRendering="crispEdges"
      className="rounded-[10px] bg-white"
    >
      <path d={path} fill="#18181b" />
    </svg>
  );
}
