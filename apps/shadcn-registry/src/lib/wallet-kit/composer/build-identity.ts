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

export function buildWalletKitIdentity({
  auth,
  address,
  chainId,
  isBooting,
  isConnected,
  svm,
  walletName,
  walletSource,
}: {
  auth: AuthRuntime;
  address?: string;
  chainId?: number;
  isBooting: boolean;
  isConnected: boolean;
  svm?: SvmWalletRuntime;
  walletName?: string;
  walletSource?: AomiSessionIdentity["walletSource"];
}): AomiSessionIdentity {
  const svmIdentity = svm?.identity(Date.now());
  const svmAddress = svmIdentity?.address;
  const svmTransport = svmIdentity?.transport;
  const svmCapabilities = svmIdentity?.capabilities;
  const baseSvm = {
    svmAddress,
    svmCluster: svmIdentity?.cluster,
    svmWalletName: svmIdentity?.walletName,
    svmTransport: svmAddress ? svmTransport : undefined,
    svmCapabilities,
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
      walletKind: "eoa",
      chainId,
      sessionProvider: auth.sessionProvider,
      embeddedProvider: auth.embeddedProvider,
      walletSource:
        walletSource ??
        (address && auth.embeddedProvider ? "embedded" : undefined),
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
      walletSource:
        walletSource ?? (auth.embeddedProvider ? "embedded" : "injected"),
      walletProviderSubject: auth.subject,
      authMethod: auth.authMethod ?? "wagmi",
      authValue: auth.authValue,
      primaryLabel: formatWalletAddress(address) ?? "Connected wallet",
      secondaryLabel:
        walletName ??
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
      walletSource: "injected",
      walletProviderSubject: auth.subject,
      authMethod: auth.authMethod,
      authValue: auth.authValue,
      primaryLabel: formatWalletAddress(svmAddress) ?? "Connected Solana wallet",
      secondaryLabel: "Solana",
      svmCluster: svmIdentity?.cluster,
      svmWalletName: svmIdentity?.walletName,
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
