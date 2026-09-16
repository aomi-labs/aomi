"use client";

import type { ReactNode } from "react";
import type { Chain, Transport } from "viem";
import type { CreateConnectorFn } from "wagmi";
import type { SponsorshipPaymasterServiceContext } from "@aomi-labs/react";
import type {
  AuthProviderId,
  AomiAccountCredential,
  SvmNetworkOption,
} from "../types";
import type {
  EvmWalletId,
  EvmWalletPreset,
  SvmWalletId,
  SvmWalletPreset,
} from "../catalog/wallet-ids";

export type AuthMethodId =
  | "google"
  | "apple"
  | "x"
  | "discord"
  | "github"
  | "farcaster"
  | "telegram"
  | "email"
  | "phone"
  | "passkey"
  | "wallet";

export type ProvidersConfig = {
  para?:
    | {
        apiKey?: string;
        environment?: "PROD" | "BETA";
        appName?: string;
        appDescription?: string;
        appUrl?: string;
        disableWorkers?: boolean;
      }
    | false;
  privy?:
    | {
        appId?: string;
        appName?: string;
        appLogoUrl?: string;
      }
    | false;
  [providerId: string]: unknown;
};

export type AomiSession = {
  provider: AuthProviderId;
  subject?: string;
  credential?: AomiAccountCredential;
};

export type AuthConfig =
  | {
      provider: AuthProviderId;
      methods?: readonly AuthMethodId[];
    }
  | false;

export type AomiWidgetAuthConfig =
  | false
  | {
      provider: AuthProviderId;
      environment: string;
      methods?: readonly AuthMethodId[];
      providers?: ProvidersConfig;
    };

export type EvmWalletsConfig = {
  chains?: readonly [Chain, ...Chain[]];
  preset?: EvmWalletPreset;
  wallets?: readonly EvmWalletId[];
  connectors?: readonly CreateConnectorFn[];
  walletConnectProjectId?: string;
  coinbase?: boolean;
  appName?: string;
  appLogoUrl?: string | null;
  transports?: Record<number, Transport>;
  /**
   * Persist the external EVM connector and silently restore it after reload.
   * Defaults to true. An explicit disconnect remains persisted by the wallet
   * connector and prevents the next mount from reconnecting it.
   */
  persistConnections?: boolean;
};

export type SvmWalletsConfig = {
  preset?: SvmWalletPreset;
  wallets?: readonly SvmWalletId[];
  networks?: readonly SvmNetworkOption[];
  preferDirectSend?: boolean;
};

export type WalletsConfig = {
  evm?: EvmWalletsConfig | false;
  solana?: SvmWalletsConfig | false;
};

export type ExecutionConfig = {
  aa?: "off" | "optional" | "required";
  sponsorship?:
    | { mode?: "disabled" }
    | {
        mode: "optional";
        paymasterServiceContext?:
          | SponsorshipPaymasterServiceContext
          | ((
              chainId: number,
            ) => SponsorshipPaymasterServiceContext | undefined);
        paymasterServiceUrl?:
          | string
          | ((chainId: number) => string | undefined);
        sendCallsTimeoutMs?: number;
        sendCallsVersion?: string;
      }
    | {
        mode: "required";
        paymasterServiceContext?:
          | SponsorshipPaymasterServiceContext
          | ((
              chainId: number,
            ) => SponsorshipPaymasterServiceContext | undefined);
        paymasterServiceUrl?:
          | string
          | ((chainId: number) => string | undefined);
        sendCallsTimeoutMs?: number;
        sendCallsVersion?: string;
      };
};

/**
 * Single source of truth for how the widget mints its own backend session.
 * `provider` mode exchanges a host provider credential; `wallet` mode signs a
 * SIWE/SIWS challenge with the connected external wallet.
 */
export type WidgetAuthConfig =
  | { mode: "provider"; provider: string; environment: string }
  | { mode: "wallet" };

export type AccountConfig =
  | false
  | { mode: "disabled" }
  | {
      mode: "aomi-backend";
      baseUrl?: string;
      authDomain?: string;
      authUri?: string;
      widgetAuth?: WidgetAuthConfig;
    };

export type AomiWalletKitProviderProps = {
  preset?: "para" | "privy" | "wallets-only" | (string & {});
  providers?: ProvidersConfig;
  auth?: AuthConfig;
  wallets?: WalletsConfig;
  execution?: ExecutionConfig;
  account?: AccountConfig;
  children?: ReactNode;
};

export type AomiWalletKitProviderInput =
  | AomiWalletKitProviderProps
  | {
      auth: {
        provider: "para";
        apiKey?: string;
        environment?: "PROD" | "BETA";
        methods?: readonly AuthMethodId[];
        appName?: string;
        appDescription?: string;
        disableWorkers?: boolean;
      };
      children: ReactNode;
    }
  | {
      auth: {
        provider: "privy";
        appId?: string;
        methods?: readonly AuthMethodId[];
        appName?: string;
      };
      children: ReactNode;
    };
