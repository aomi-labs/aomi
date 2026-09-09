"use client";

import { useEffect, type FC } from "react";
import { cn, formatAddress, getChainInfo } from "@aomi-labs/react";
import { useAomiWalletKit } from "../../lib/wallet-kit";
import { DualWalletBar } from "./dual-wallet-bar";
import { formatWalletProvider } from "../../lib/wallet-kit";
import type { WalletAccountMenuOptions } from "./account-menu-types";

export type ConnectButtonProps = {
  className?: string;
  connectLabel?: string;
  onConnectionChange?: (connected: boolean) => void;
  families?: Array<"evm" | "solana">;
  accountMenu?: WalletAccountMenuOptions;
};

type WalletFamilyFilter = NonNullable<ConnectButtonProps["families"]>[number];

function inferWalletFamilies(
  adapter: ReturnType<typeof useAomiWalletKit>,
): WalletFamilyFilter[] {
  const families: WalletFamilyFilter[] = [];
  if (
    (adapter.supportedNetworks?.evm.length ?? 0) > 0 ||
    (adapter.evmWallets?.length ?? 0) > 0 ||
    adapter.identity.address
  ) {
    families.push("evm");
  }
  if (
    (adapter.supportedNetworks?.solana.length ?? 0) > 0 ||
    (adapter.solanaWallets?.length ?? 0) > 0 ||
    adapter.identity.svmAddress
  ) {
    families.push("solana");
  }
  return families;
}

const SingleConnectButton: FC<Omit<ConnectButtonProps, "families">> = ({
  className,
  connectLabel = "Connect Account",
  onConnectionChange,
}) => {
  const adapter = useAomiWalletKit();
  const identity = adapter.identity;

  useEffect(() => {
    onConnectionChange?.(identity.isConnected);
  }, [identity.isConnected, onConnectionChange]);

  const handleClick = () => {
    if (
      identity.isConnected &&
      adapter.canOpenAccountUI &&
      adapter.openAccountUI
    ) {
      void adapter.openAccountUI();
      return;
    }
    if (identity.isConnected && adapter.canDisconnect && adapter.disconnect) {
      void adapter.disconnect();
      return;
    }
    if (adapter.canConnect) {
      void adapter.connect();
    }
  };

  const ticker = identity.chainId
    ? getChainInfo(identity.chainId)?.ticker
    : undefined;
  const walletProviderLabel = formatWalletProvider(
    identity.sessionProvider ?? identity.embeddedProvider,
  );
  const visibleAddress = identity.address ?? identity.svmAddress;
  const connectedPrimary =
    formatAddress(visibleAddress) ??
    walletProviderLabel ??
    (identity.isConnected ? "Connected" : connectLabel);
  const primaryLabel =
    identity.status === "disconnected" ? connectLabel : connectedPrimary;
  const secondaryLabel = identity.isConnected
    ? (walletProviderLabel ?? ticker)
    : undefined;
  const ariaLabel = identity.isConnected
    ? adapter.canOpenAccountUI
      ? "Manage account"
      : adapter.canDisconnect
        ? "Disconnect account"
        : "Connected account"
    : "Connect account";

  return (
    <button
      type="button"
      onClick={handleClick}
      className={cn(
        "inline-flex items-center justify-center gap-2 whitespace-nowrap text-sm font-medium",
        "rounded-3xl px-5 py-2.5",
        "bg-primary text-primary-foreground",
        "hover:bg-primary/90",
        "transition-colors",
        "focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2",
        "disabled:pointer-events-none disabled:opacity-50",
        className,
      )}
      aria-label={ariaLabel}
      disabled={
        !adapter.canOpenAccountUI &&
        !adapter.canDisconnect &&
        !adapter.canConnect
      }
    >
      <span className="max-w-[180px] truncate">{primaryLabel}</span>
      {identity.isConnected && secondaryLabel && (
        <span className="opacity-50">{secondaryLabel}</span>
      )}
    </button>
  );
};

export const ConnectButton: FC<ConnectButtonProps> = ({
  families,
  className,
  connectLabel,
  onConnectionChange,
  accountMenu,
}) => {
  const adapter = useAomiWalletKit();
  const pickerFamilies =
    families && families.length > 0 ? families : inferWalletFamilies(adapter);
  const shouldUsePicker = Boolean(
    pickerFamilies.length > 0 && (adapter.walletModalRows?.length ?? 0) > 0,
  );

  if (shouldUsePicker) {
    return (
      <DualWalletBar
        families={pickerFamilies}
        className={className}
        disconnectedLabel={connectLabel}
        onConnectionChange={onConnectionChange}
        accountMenu={accountMenu}
      />
    );
  }
  return (
    <SingleConnectButton
      className={className}
      connectLabel={connectLabel}
      onConnectionChange={onConnectionChange}
    />
  );
};
