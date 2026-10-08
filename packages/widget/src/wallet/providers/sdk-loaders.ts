import type { WalletProviderPlugin } from "./plugin-registry";
import { setParaSdk } from "./para/para-sdk";
import { setPrivySdk } from "./privy/privy-sdk";

/** The host chose a provider whose optional SDK package is not installed. */
export class MissingWalletSdkError extends Error {
  constructor(provider: string, packages: readonly string[], cause: unknown) {
    super(
      `${provider} sign-in needs ${packages.join(" and ")}. Install ${packages.length > 1 ? "them" : "it"} in the host app: npm install ${packages.join(" ")}`,
      { cause },
    );
    this.name = "MissingWalletSdkError";
  }
}

// Each SDK import sits directly inside a try block: bundlers then treat the
// optional peer as optional, so hosts that never install it still build.

export async function loadPrivyPlugin(): Promise<WalletProviderPlugin> {
  try {
    const [auth, smartWallets, solana] = await Promise.all([
      import("@privy-io/react-auth"),
      import("@privy-io/react-auth/smart-wallets"),
      import("@privy-io/react-auth/solana"),
    ]);
    setPrivySdk({ auth, smartWallets, solana });
  } catch (cause) {
    throw new MissingWalletSdkError("Privy", ["@privy-io/react-auth"], cause);
  }
  return (await import("./privy/privy-plugin")).privyPlugin;
}

export async function loadParaPlugin(): Promise<WalletProviderPlugin> {
  try {
    const [react, wagmi] = await Promise.all([
      import("@getpara/react-sdk"),
      import("@getpara/wagmi-v2-connector"),
      import("@getpara/react-sdk/styles.css"),
    ]);
    setParaSdk({ react, wagmi });
  } catch (cause) {
    throw new MissingWalletSdkError(
      "Para",
      ["@getpara/react-sdk", "@getpara/wagmi-v2-connector"],
      cause,
    );
  }
  return (await import("./para/para-plugin")).paraPlugin;
}
