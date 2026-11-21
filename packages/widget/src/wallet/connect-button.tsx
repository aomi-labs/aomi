"use client";

import { aomiButton } from "@/ui/aomi/button";
import { cn } from "@/lib/cn";
import { useEffect, type FC } from "react";
import { getChainInfo } from "@aomi-labs/react";
import { useAomiWalletKit } from "./context";
import { DualWalletBar } from "./dual-wallet-bar";
import { formatWalletProvider } from "./identity";
import type { WalletAccountMenuOptions } from "@/account/account-menu-types";
import { shortAddress } from "@aomi-labs/client";

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
  const connectedPrimary = visibleAddress
    ? shortAddress(visibleAddress)
    : "Connect Wallet";
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
        aomiButton({ variant: "primary" }),
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
  // While the wallet kit boots nothing can connect yet; keep the picker chip
  // rather than flashing the single-button fallback.
  const shouldUsePicker = Boolean(
    pickerFamilies.length > 0 &&
    (adapter.identity.status === "booting" ||
      adapter.canConnect ||
      adapter.wallets.length > 0),
  );

  if (accountMenu?.enabled || shouldUsePicker) {
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
