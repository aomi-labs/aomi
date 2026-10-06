import {
  buildSiweMessage,
  buildSiwsMessage,
  buildWalletLinkMessage,
  withBrowserSessionTransition,
} from "@aomi-labs/client";
import type { SvmWalletRuntime } from "../composer/types";
import type { EvmWalletRuntime } from "../runtime/evm/wallet-runtime";
import type { SvmCluster } from "../types";
import type { AccountRuntime } from "./types";
import type {
  AomiBackendAccountResponse,
  createAomiBackendAccountClient,
} from "./aomi-backend-client";
import { messageConfigFromNonce, type AuthMessageConfig } from "./auth-message";
import {
  buildDefaultWalletLabel,
  resolveLinkedWalletName,
} from "./wallet-labels";
import { utf8ToBase64 } from "./encoding";

type AccountClient = ReturnType<typeof createAomiBackendAccountClient>;

/** The active Solana signer, when one is connected. */
export type ActiveSvmSigner = {
  address?: string;
  cluster: SvmCluster;
  external: boolean;
  walletName?: string;
  signMessage?: SvmWalletRuntime["execution"]["signSolanaMessage"];
};

/**
 * Sign in with, or link, the wallet the user picked. A signed-out user (or a
 * guest) signs in with it; a signed-in user links it to the account.
 * Returns the account when the backend sends it back with the link.
 */
export async function linkAccountWallet(
  input: {
    accountClient: AccountClient;
    account: AomiBackendAccountResponse | null;
    /** Widget wallet mode signs in through the widget session instead. */
    walletSessionSignIn?: () => Promise<unknown>;
    evm: EvmWalletRuntime;
    activeEvmAddress?: string;
    activeEvmChainId?: number;
    svm: ActiveSvmSigner;
    messageConfig: AuthMessageConfig;
  },
  wallet: Parameters<NonNullable<AccountRuntime["linkWallet"]>>[0],
): Promise<AomiBackendAccountResponse | undefined> {
  const { accountClient, account, evm, svm, messageConfig } = input;
  const signedIn = Boolean(account?.user) && !account?.guest;
  const replaceGuestSession = account?.guest
    ? () => accountClient.signOut()
    : undefined;
  if (input.walletSessionSignIn && !signedIn) {
    const activeAddress =
      wallet.family === "svm" ? svm.address : input.activeEvmAddress;
    const matches =
      wallet.family === "svm"
        ? wallet.address === activeAddress
        : wallet.address.toLowerCase() === activeAddress?.toLowerCase();
    if (!matches) throw new Error("Select this wallet before linking it");
    await input.walletSessionSignIn();
    return;
  }
  if (wallet.family === "svm") {
    const signMessage = svm.signMessage;
    if (
      !svm.address ||
      wallet.address !== svm.address ||
      !svm.external ||
      !signMessage
    ) {
      throw new Error(
        "Wallet linking requires the active external Solana signer",
      );
    }
    await authenticateSvmWallet({
      accountClient,
      address: wallet.address,
      chainId: svm.cluster,
      intent: signedIn ? "link" : "sign-in",
      replaceGuestSession,
      label: buildDefaultWalletLabel({
        walletName: svm.walletName,
        existingWallets: account?.wallets ?? [],
        family: "svm",
      }),
      messageConfig,
      signMessage: (message) =>
        signMessageWithActiveSvm(signMessage, message, svm.cluster),
    });
    return;
  }
  if (!evm.signMessageForAccount && !evm.signMessageAsync) {
    throw new Error("Wallet linking requires an active EVM signer");
  }
  const chainId = wallet.chainId ?? input.activeEvmChainId;
  if (!chainId) throw new Error("Wallet linking requires an EVM chain id");
  const accountId = wallet.accountId;
  const signMessageForAccount = evm.signMessageForAccount;
  const signMessage = (message: string) =>
    accountId && signMessageForAccount
      ? signMessageForAccount({ accountId, chainId, message })
      : signMessageWithActiveEvm(evm.signMessageAsync, message);
  if (!signedIn) {
    await signInWithEvmWallet({
      accountClient,
      address: wallet.address as `0x${string}`,
      chainId,
      replaceGuestSession,
      signMessage,
      messageConfig,
    });
    return;
  }
  const nonceResult = await accountClient.getWalletLinkNonce({
    address: wallet.address,
    chainId,
  });
  const message = buildWalletLinkMessage({
    address: wallet.address,
    chainId,
    nonce: nonceResult.nonce,
    ...messageConfigFromNonce(nonceResult, messageConfig),
  });
  const signature = await signMessage(message);
  // Name the label after the wallet being linked, not whichever wallet is the
  // active signer: linking MetaMask while a Privy wallet is active reads "MetaMask N".
  const label = buildDefaultWalletLabel({
    walletName: resolveLinkedWalletName({
      accounts: evm.accounts(Date.now()),
      accountId,
      address: wallet.address,
      fallbackWalletName: evm.activeEvmConnection?.walletName,
    }),
    existingWallets: account?.wallets ?? [],
    family: wallet.family,
  });
  const result = await accountClient.linkWallet({
    ...wallet,
    chainId,
    label,
    message,
    signature,
    nonce: nonceResult.nonce,
  });
  return result.account;
}

async function signMessageWithActiveEvm(
  signMessageAsync: EvmWalletRuntime["signMessageAsync"],
  message: string,
): Promise<`0x${string}`> {
  if (!signMessageAsync) {
    throw new Error("Wallet linking requires an active EVM signer");
  }
  return (await (
    signMessageAsync as (args: { message: string }) => Promise<`0x${string}`>
  )({ message })) as `0x${string}`;
}

async function signInWithEvmWallet(input: {
  accountClient: AccountClient;
  address: `0x${string}`;
  chainId: number;
  signMessage: (message: string) => Promise<`0x${string}`>;
  messageConfig: AuthMessageConfig;
  replaceGuestSession?: () => Promise<void>;
}): Promise<void> {
  await withBrowserSessionTransition(async () => {
    // A wallet may already own a durable account, so replace the disposable
    // guest before issuing a sign-in challenge instead of linking the two.
    await input.replaceGuestSession?.();
    const nonceResult = await input.accountClient.createSiweNonce();
    const message = buildSiweMessage({
      address: input.address,
      chainId: input.chainId,
      nonce: nonceResult.nonce,
      ...messageConfigFromNonce(nonceResult, input.messageConfig),
    });
    const signature = await input.signMessage(message);
    await input.accountClient.verifySiwe({
      message,
      signature,
    });
  });
}

async function signMessageWithActiveSvm(
  signMessage: NonNullable<SvmWalletRuntime["execution"]["signSolanaMessage"]>,
  message: string,
  chainId: SvmCluster,
): Promise<string> {
  const result = await signMessage({
    message: utf8ToBase64(message),
    cluster: chainId,
    description: "Authorize this Solana wallet for your Aomi account.",
  });
  return result.signature;
}

async function authenticateSvmWallet(input: {
  accountClient: AccountClient;
  address: string;
  chainId: SvmCluster;
  intent: "sign-in" | "link";
  label?: string;
  signMessage: (message: string) => Promise<string>;
  messageConfig: AuthMessageConfig;
  replaceGuestSession?: () => Promise<void>;
}): Promise<void> {
  await withBrowserSessionTransition(async () => {
    await input.replaceGuestSession?.();
    const nonceResult = await input.accountClient.createSiwsNonce({
      walletAddress: input.address,
      chainId: input.chainId,
      intent: input.intent,
    });
    const message = buildSiwsMessage({
      address: input.address,
      chainId: input.chainId,
      nonce: nonceResult.nonce,
      intent: input.intent,
      ...messageConfigFromNonce(nonceResult, input.messageConfig),
    });
    const signature = await input.signMessage(message);
    await input.accountClient.verifySiws({
      message,
      signature,
      walletAddress: input.address,
      chainId: input.chainId,
      intent: input.intent,
      label: input.label,
    });
  });
}
