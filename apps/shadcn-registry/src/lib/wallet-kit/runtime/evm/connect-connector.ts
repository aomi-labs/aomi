import type { Config, Connector } from "wagmi";

type Connection = { accounts: readonly `0x${string}`[]; chainId: number };
const pending = new WeakMap<Connector, Promise<Connection>>();

/** Reconcile a restored connector against the provider, rather than cached accounts. */
async function refreshConnection(connector: Connector): Promise<Connection> {
  const accounts = await connector.getAccounts();
  const chainId = await connector.getChainId();
  // The normal wagmi change listener updates both its store and the registry
  // source. A browser restart may have missed the extension's accountsChanged.
  connector.emitter.emit("change", { accounts, chainId });
  return { accounts, chainId };
}

export async function connectEvmConnector({
  connector,
  config,
  connect,
  disconnect,
  switchAccount,
  expectedAddress,
}: {
  connector: Connector;
  config: Config;
  connect: () => Promise<Connection>;
  disconnect?: () => Promise<unknown>;
  switchAccount?: () => Promise<unknown>;
  expectedAddress?: string;
}): Promise<Connection> {
  let operation = pending.get(connector);
  if (!operation) {
    operation = (async () => {
      if (config.state.connections.has(connector.uid)) {
        const fresh = await refreshConnection(connector);
        if (fresh.accounts.length) {
          await switchAccount?.();
          return fresh;
        }
        // The browser remembers a connector whose extension authorization has
        // gone away. Detach only that connector before asking to connect again.
        await disconnect?.();
      }
      try {
        return await connect();
      } catch (error) {
        // Auto-reconnect can finish while the explicit request is in flight.
        if (
          error instanceof Error &&
          error.name === "ConnectorAlreadyConnectedError"
        ) {
          const fresh = await refreshConnection(connector);
          if (fresh.accounts.length) {
            await switchAccount?.();
            return fresh;
          }
          throw new Error(
            `Open ${connector.name}, unlock it, then click Connect again.`,
          );
        }
        throw error;
      }
    })();
    pending.set(connector, operation);
  }
  let result: Connection;
  try {
    result = await operation;
  } finally {
    if (pending.get(connector) === operation) pending.delete(connector);
  }
  if (
    expectedAddress &&
    !result.accounts.some(
      (address) => address.toLowerCase() === expectedAddress.toLowerCase(),
    )
  ) {
    const address = `${expectedAddress.slice(0, 6)}…${expectedAddress.slice(-4)}`;
    throw new Error(
      `Select ${address} in ${connector.name}, then click Connect again. Your Aomi account is still signed in.`,
    );
  }
  return result;
}
