import type { Wallets } from "@aomi-labs/client";
import {
  createWalletClient,
  custom,
  getAddress,
  type Address,
  type EIP1193Provider,
  type Hex,
  type WalletClient,
} from "viem";

export interface InjectedProvider {
  id: string;
  name: string;
  provider: EIP1193Provider;
}

interface Eip6963ProviderDetail {
  info: { name: string; rdns: string; uuid: string };
  provider: EIP1193Provider;
}

/**
 * The user's own browser wallet (window.ethereum), driven through viem.
 *
 * Aomi never holds keys. It hands the page unsigned transactions; this class
 * is the only place that asks the wallet to sign and send them.
 */
export class InjectedWallet {
  private constructor(
    private readonly provider: EIP1193Provider,
    private readonly client: WalletClient,
    readonly address: Address,
    private currentChainId: number,
  ) {}

  /** Discover each injected wallet without relying on an ambiguous global. */
  static async providers(): Promise<InjectedProvider[]> {
    const providers = new Map<string, InjectedProvider>();
    const announce = (event: Event) => {
      const { info, provider } = (event as CustomEvent<Eip6963ProviderDetail>)
        .detail;
      providers.set(info.uuid, {
        id: info.uuid,
        name: info.name,
        provider,
      });
    };
    window.addEventListener("eip6963:announceProvider", announce);
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    await new Promise((resolve) => setTimeout(resolve, 100));
    window.removeEventListener("eip6963:announceProvider", announce);

    if (!providers.size && window.ethereum) {
      providers.set("legacy", {
        id: "legacy",
        name: "Browser wallet",
        provider: window.ethereum,
      });
    }
    return [...providers.values()];
  }

  /** Prompt one explicitly selected injected wallet for an account. */
  static async connect(provider: EIP1193Provider): Promise<InjectedWallet> {
    if (!provider) {
      throw new Error(
        "No injected wallet found. Install MetaMask, Rabby, or another EIP-1193 wallet.",
      );
    }
    const client = createWalletClient({ transport: custom(provider) });
    const [address] = await client.requestAddresses();
    if (!address) throw new Error("The wallet did not return an account");
    return new InjectedWallet(
      provider,
      client,
      address,
      await client.getChainId(),
    );
  }

  get chainId(): number {
    return this.currentChainId;
  }

  /**
   * Follow chain and account switches made in the wallet UI. An account change
   * means a different signer, so the page should start over. Returns an
   * unsubscribe function.
   */
  watch(onChange: (change: "chain" | "account") => void): () => void {
    const chainChanged = (chainId: string) => {
      this.currentChainId = Number(chainId);
      onChange("chain");
    };
    const accountsChanged = (accounts: readonly Address[]) => {
      if (accounts[0]?.toLowerCase() !== this.address.toLowerCase()) {
        onChange("account");
      }
    };
    this.provider.on("chainChanged", chainChanged);
    this.provider.on("accountsChanged", accountsChanged);
    return () => {
      this.provider.removeListener("chainChanged", chainChanged);
      this.provider.removeListener("accountsChanged", accountsChanged);
    };
  }

  async switchChain(chainId: number): Promise<void> {
    if (chainId === this.currentChainId) return;
    await this.client.switchChain({ id: chainId });
    this.currentChainId = chainId;
  }

  /** One wallet prompt: sign and broadcast a single call. */
  async send(input: {
    chainId: number;
    to: string;
    data?: string;
    value?: string;
  }): Promise<Hex> {
    await this.switchChain(input.chainId);
    return this.client.sendTransaction({
      account: this.address,
      // The wallet owns chain selection; switchChain above already ran.
      chain: null,
      to: getAddress(input.to),
      data: input.data as Hex | undefined,
      value: BigInt(input.value ?? "0"),
    });
  }

  /**
   * Adapt this wallet to the SDK's `Wallets` contract. The SDK calls these
   * methods only after the page invokes `session.actions.execute(...)`, which
   * this example does only when the user clicks Approve.
   */
  toAomiWallets(): Wallets {
    return {
      evm: {
        address: this.address,
        chainId: () => this.currentChainId,
        switchChain: (chainId) => this.switchChain(chainId),
        // Ordinary `execute_evm` Actions: one wallet prompt per call.
        sendTransaction: (call) => this.send(call),
        // Durable (Commit Service) Actions: the SDK records an attempt first,
        // then asks the wallet to send the prepared transaction.
        preparePreparedTransaction: async (payload) => {
          if (payload.signer.toLowerCase() !== this.address.toLowerCase()) {
            throw new Error("Connect the wallet that this transaction expects");
          }
        },
        sendPreparedTransaction: async (payload, onPhase) => {
          if (payload.chain_id !== this.currentChainId) {
            onPhase?.("switching_chain");
          }
          await this.switchChain(payload.chain_id);
          onPhase?.("awaiting_wallet");
          // Browser wallets pick their own pending nonce and fees; the commit
          // is verified on-chain by the Commit Service afterwards.
          return this.send({
            chainId: payload.chain_id,
            to: payload.transaction.to,
            data: payload.transaction.data,
            value: payload.transaction.value,
          });
        },
      },
    };
  }
}
