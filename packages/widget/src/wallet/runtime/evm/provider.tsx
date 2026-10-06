"use client";

import type { ReactNode } from "react";
import { WagmiProvider, type Config } from "wagmi";

export function AomiEvmRuntimeProvider({
  children,
  config,
  reconnectOnMount = true,
}: {
  children: ReactNode;
  config: Config;
  reconnectOnMount?: boolean;
}) {
  return (
    <WagmiProvider config={config} reconnectOnMount={reconnectOnMount}>
      {children}
    </WagmiProvider>
  );
}
