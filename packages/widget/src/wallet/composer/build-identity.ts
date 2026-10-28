"use client";

import { DEFAULT_SVM_CLUSTER } from "@/wallet/catalog/svm-networks";
import {
  AOMI_SESSION_BOOTING_IDENTITY,
  AOMI_SESSION_DISCONNECTED_IDENTITY,
  formatAuthMethod,
  formatWalletAddress,
  formatWalletProvider,
} from "@/wallet/identity";
import type { AomiSessionIdentity, WalletSource } from "@/wallet/types";
import type { AuthRuntime, SvmWalletRuntime } from "./types";
import type { WalletRow } from "./wallet-state";

export function buildWalletKitIdentity({
  auth,
  evmWallet,
  svmWallet,
  isBooting,
  isConnected,
  svm,
}: {
  auth: AuthRuntime;
  evmWallet?: WalletRow;
  svmWallet?: WalletRow;
  isBooting: boolean;
  isConnected: boolean;
  svm?: SvmWalletRuntime;
}): AomiSessionIdentity {
  const svmIdentity = svm?.identity(Date.now());
  const address = evmWallet?.address;
  const chainId = evmWallet?.chainId;
  const svmAddress = svmWallet?.address;
  const svmTransport = svmIdentity?.transport;
  const svmCapabilities = svmIdentity?.capabilities;
  const svmCluster =
    svmWallet?.kind === "agent"
      ? (svm?.selectedNetwork?.cluster ??
        svmIdentity?.cluster ??
        DEFAULT_SVM_CLUSTER)
      : svmIdentity?.cluster;
  const baseSvm = {
    svmAddress,
    svmCluster,
    svmWalletName: svmWallet?.walletName ?? svmIdentity?.walletName,
    svmTransport: svmAddress ? svmTransport : undefined,
    svmCapabilities: svmAddress ? svmCapabilities : undefined,
  };

  if (isBooting) {
    return {
      ...AOMI_SESSION_BOOTING_IDENTITY,
      chainId,
      ...baseSvm,
    };
  }

  if (isConnected && auth.primaryLabel) {
    return {
      status: "connected",
      isConnected: true,
      address,
      walletKind: address ? "eoa" : undefined,
      chainId,
      sessionProvider: auth.sessionProvider,
      embeddedProvider: auth.embeddedProvider,
      walletSource: evmWallet ? walletSourceOf(evmWallet) : undefined,
      walletProviderSubject: auth.subject,
      authMethod: auth.authMethod,
      authValue: auth.authValue,
      primaryLabel: auth.primaryLabel,
      secondaryLabel:
        formatAuthMethod(auth.authMethod) ??
        formatWalletProvider(auth.provider),
      ...baseSvm,
    };
  }

  if (isConnected && address) {
    return {
      status: "connected",
      isConnected: true,
      address,
      walletKind: "eoa",
      chainId,
      sessionProvider: auth.sessionProvider,
      embeddedProvider: auth.embeddedProvider,
      walletSource: evmWallet ? walletSourceOf(evmWallet) : "injected",
      walletProviderSubject: auth.subject,
      authMethod: auth.authMethod ?? "wagmi",
      authValue: auth.authValue,
      primaryLabel: formatWalletAddress(address) ?? "Connected wallet",
      secondaryLabel:
        evmWallet?.walletName ??
        (evmWallet?.kind === "agent" ? "Agent wallet" : undefined) ??
        formatAuthMethod(auth.authMethod ?? "wagmi") ??
        formatWalletProvider(auth.provider),
      ...baseSvm,
    };
  }

  if (svmAddress) {
    return {
      status: "connected",
      isConnected: true,
      walletKind: undefined,
      chainId,
      ...baseSvm,
      sessionProvider: auth.sessionProvider,
      walletSource: svmWallet ? walletSourceOf(svmWallet) : "injected",
      walletProviderSubject: auth.subject,
      authMethod: auth.authMethod,
      authValue: auth.authValue,
      primaryLabel:
        formatWalletAddress(svmAddress) ?? "Connected Solana wallet",
      secondaryLabel: "Solana",
    };
  }

  return {
    ...AOMI_SESSION_DISCONNECTED_IDENTITY,
    chainId,
    sessionProvider: auth.sessionProvider,
    walletProviderSubject: auth.subject,
    authMethod: auth.authMethod,
    authValue: auth.authValue,
    svmCluster,
  };
}

function walletSourceOf(wallet: WalletRow): WalletSource {
  if (wallet.kind === "agent") return "agent";
  return wallet.kind === "embedded" ? "embedded" : "injected";
}
