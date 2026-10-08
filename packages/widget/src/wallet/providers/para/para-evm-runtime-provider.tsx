"use client";

import { useLayoutEffect, useState, type ReactNode } from "react";
import type { paraConnector } from "@getpara/wagmi-v2-connector";
import type ParaWeb from "@getpara/react-sdk";
import type { Config } from "wagmi";
import {
  createAomiEvmConfig,
  type ResolvedEvmWalletsConfig,
} from "@/wallet/catalog/evm-connector-catalog";
import { AomiEvmRuntimeProvider } from "@/wallet/runtime/evm/provider";
import { useSafeParaClient } from "./para-auth";
import { paraSdk } from "./para-sdk";

type AomiConnector = NonNullable<
  ResolvedEvmWalletsConfig["connectors"]
>[number];
type ConnectorPara = Parameters<typeof paraConnector>[0]["para"];

export function createAomiParaEvmConfig(
  config: ResolvedEvmWalletsConfig,
  para: ParaWeb | null,
): Config {
  return createAomiEvmConfig({
    ...config,
    connectors: [
      ...(config.connectors ?? []),
      ...(para
        ? [
            // Consumers can use a newer compatible Para SDK than widget-lib.
            // Para's private fields make those otherwise-compatible SDK
            // instances nominal, so normalize both Para and Wagmi types at
            // this package boundary.
            paraSdk().wagmi.paraConnector({
              para: para as unknown as ConnectorPara,
              chains: [...config.chains],
              disableModal: true,
              appName: config.appName ?? "Aomi",
              options: { shimDisconnect: true },
              transports: config.transports,
            }) as unknown as AomiConnector,
          ]
        : []),
      // paraConnector()'s return type isn't assignable to wagmi's
      // `readonly CreateConnectorFn[]` under the current SDK versions.
    ] as ResolvedEvmWalletsConfig["connectors"],
  });
}

// One wagmi config per Para client and wallet setup: each new config inits
// WalletConnect again and announces to every injected wallet.
const paraConfigs = new WeakMap<object, Map<string, Config>>();

function paraEvmConfig(
  config: ResolvedEvmWalletsConfig,
  para: ParaWeb | null,
): Config {
  if (!para || config.connectors?.length || config.transports)
    return createAomiParaEvmConfig(config, para);
  const key = JSON.stringify([
    config.chains.map((chain) => [chain.id, chain.rpcUrls.default.http[0]]),
    config.preset ?? null,
    config.wallets ?? null,
    config.walletConnectProjectId ?? null,
    config.coinbase ?? null,
    config.appName ?? null,
    config.appLogoUrl ?? null,
    config.persistConnections ?? null,
  ]);
  const configs = paraConfigs.get(para) ?? new Map<string, Config>();
  paraConfigs.set(para, configs);
  const cached = configs.get(key);
  if (cached) return cached;
  const created = createAomiParaEvmConfig(config, para);
  configs.set(key, created);
  return created;
}

export function AomiParaEvmRuntimeProvider({
  children,
  config,
}: {
  children: ReactNode;
  config: ResolvedEvmWalletsConfig;
}) {
  const para = useSafeParaClient();
  // Built after render: creating a config updates other mounted stores.
  const [wagmiConfig, setWagmiConfig] = useState<Config | null>(null);
  useLayoutEffect(() => {
    setWagmiConfig(paraEvmConfig(config, para));
  }, [config, para]);
  if (!wagmiConfig) return null;

  return (
    <AomiEvmRuntimeProvider config={wagmiConfig}>
      {children}
    </AomiEvmRuntimeProvider>
  );
}
