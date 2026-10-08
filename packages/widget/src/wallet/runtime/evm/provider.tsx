"use client";

import { createContext, memo, useContext, type ReactNode } from "react";
import { WagmiProvider, type Config } from "wagmi";

const RuntimeChildren = createContext<ReactNode>(null);

function RuntimeChildrenOutlet() {
  return <>{useContext(RuntimeChildren)}</>;
}

// WagmiProvider reconnects during every render it gets. Rendering it only when
// its config changes stops repeated reconnects (and WalletConnect inits) and
// store updates to already-mounted wallet components mid-render.
const StableWagmiProvider = memo(function StableWagmiProvider({
  config,
  reconnectOnMount,
}: {
  config: Config;
  reconnectOnMount: boolean;
}) {
  return (
    <WagmiProvider config={config} reconnectOnMount={reconnectOnMount}>
      <RuntimeChildrenOutlet />
    </WagmiProvider>
  );
});

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
    <RuntimeChildren.Provider value={children}>
      <StableWagmiProvider
        config={config}
        reconnectOnMount={reconnectOnMount}
      />
    </RuntimeChildren.Provider>
  );
}
