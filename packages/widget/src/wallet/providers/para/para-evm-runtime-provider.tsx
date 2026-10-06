"use client";

import { useMemo, type ReactNode } from "react";
import { paraConnector } from "@getpara/wagmi-v2-connector";
import type ParaWeb from "@getpara/react-sdk";
import type { Config } from "wagmi";
import {
  createAomiEvmConfig,
  type ResolvedEvmWalletsConfig,
} from "../../catalog/evm-connector-catalog";
import { AomiEvmRuntimeProvider } from "../../runtime/evm/provider";
import { useSafeParaClient } from "./para-auth";

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
            paraConnector({
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

export function AomiParaEvmRuntimeProvider({
  children,
  config,
}: {
  children: ReactNode;
  config: ResolvedEvmWalletsConfig;
}) {
  const para = useSafeParaClient();
  const wagmiConfig = useMemo(
    () => createAomiParaEvmConfig(config, para),
    [config, para],
  );

  return (
    <AomiEvmRuntimeProvider config={wagmiConfig}>
      {children}
    </AomiEvmRuntimeProvider>
  );
}
