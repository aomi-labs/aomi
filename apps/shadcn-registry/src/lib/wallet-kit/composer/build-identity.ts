"use client";

import {
  AOMI_SESSION_BOOTING_IDENTITY,
  AOMI_SESSION_DISCONNECTED_IDENTITY,
  formatAuthMethod,
  formatWalletAddress,
  formatWalletProvider,
} from "../identity";
import type { AomiSessionIdentity } from "../types";
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
  const baseSvm = {
    svmAddress,
    svmCluster: svmIdentity?.cluster,
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
      walletSource: evmWallet
        ? evmWallet.kind === "embedded"
          ? "embedded"
          : "injected"
        : undefined,
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
      walletSource: evmWallet?.kind === "embedded" ? "embedded" : "injected",
      walletProviderSubject: auth.subject,
      authMethod: auth.authMethod ?? "wagmi",
      authValue: auth.authValue,
      primaryLabel: formatWalletAddress(address) ?? "Connected wallet",
      secondaryLabel:
        evmWallet?.walletName ??
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
      svmAddress,
      sessionProvider: auth.sessionProvider,
      walletSource: svmWallet?.kind === "embedded" ? "embedded" : "injected",
      walletProviderSubject: auth.subject,
      authMethod: auth.authMethod,
      authValue: auth.authValue,
      primaryLabel:
        formatWalletAddress(svmAddress) ?? "Connected Solana wallet",
      secondaryLabel: "Solana",
      svmCluster: svmIdentity?.cluster,
      svmWalletName: svmWallet?.walletName ?? svmIdentity?.walletName,
      svmTransport,
      svmCapabilities,
    };
  }

  return {
    ...AOMI_SESSION_DISCONNECTED_IDENTITY,
    chainId,
    sessionProvider: auth.sessionProvider,
    walletProviderSubject: auth.subject,
    authMethod: auth.authMethod,
    authValue: auth.authValue,
    svmCluster: svmIdentity?.cluster,
  };
}
