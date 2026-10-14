# Krexa Integration: Bring Your Own Privy Wallet

  Krexa's users connect their wallet at the Krexa app level (Privy). The AomiFrame inside needs to reuse   
  that same wallet session rather than showing its own connect flow.                                       
                                                                                                           
  1. Component Tree                                                                                        
                                                                                                           
  import {                                                                                                 
    AomiFrame,
    AomiWalletKitContextProvider,
    ExtUserProvider,
  } from "@aomi-labs/widget";
  import "@aomi-labs/widget/styles.css";

  function KrexaAgentPage() {
    return (
      // ExtUserProvider must wrap both Krexa's Privy context and AomiFrame
      // so wallet state flows into the chat session. It's idempotent — safe
      // to nest if AomiFrame mounts one internally.
      <ExtUserProvider>
        {/* Krexa's PrivyProvider is already above in the app layout */}
        <KrexaPrivyAdapter>
          <AomiFrame.Root
            walletPosition={null}         // hide wallet from sidebar
            backendUrl="https://..."
          >
            <AomiFrame.Header
              withControl
              controlBarProps={{
                hideWallet: true,          // hide built-in "Connect Account"
                hideNetwork: false,
              }}
            >
              {/* Optional: put Krexa's own wallet button here */}
              <KrexaConnectWalletButton />
            </AomiFrame.Header>
            <AomiFrame.Composer />
          </AomiFrame.Root>
        </KrexaPrivyAdapter>
      </ExtUserProvider>
    );
  }

  Key props:
  - walletPosition={null} — removes wallet button from the sidebar footer (the "Connect Account" you see
  bottom-left)
  - controlBarProps={{ hideWallet: true }} — removes wallet from the control bar
  - <AomiFrame.Header> children — anything passed here renders to the right of the control bar, so Krexa's
  own button goes there if they want one inside the frame

  2. The Adapter Bridge (KrexaPrivyAdapter)

  This component reads from Krexa's existing Privy/wagmi hooks and maps them into the AomiWalletKit
  interface that RuntimeTxHandler consumes.

  "use client";

  import { useMemo, type ReactNode } from "react";
  import {
    AomiWalletKitContextProvider,
    AOMI_SESSION_DISCONNECTED_IDENTITY,
    AOMI_SESSION_BOOTING_IDENTITY,
  } from "@aomi-labs/widget";
  import type {
    AomiWalletKit,
    AomiSessionIdentity,
  } from "@aomi-labs/widget";
  import {
    toViemSignTypedDataArgs,
    type WalletTxPayload,
    type WalletEip712Payload,
  } from "@aomi-labs/react";

  // Krexa's own Privy hooks (already mounted above in their app)
  import { usePrivy, useWallets } from "@privy-io/react-auth";
  import {
    useAccount,
    useSendTransaction,
    useSignTypedData,
    useSwitchChain,
  } from "wagmi";

  export function KrexaPrivyAdapter({ children }: { children: ReactNode }) {
    const { ready, authenticated, login, logout } = usePrivy();
    const { wallets } = useWallets();
    const { address, chainId, isConnected } = useAccount();
    const { sendTransactionAsync } = useSendTransaction();
    const { signTypedDataAsync } = useSignTypedData();
    const { switchChainAsync } = useSwitchChain();

    const adapter = useMemo<AomiWalletKit>(() => {
      const isBooting = !ready;
      const identity: AomiSessionIdentity = isBooting
        ? AOMI_SESSION_BOOTING_IDENTITY
        : isConnected && address
          ? {
              status: "connected",
              isConnected: true,
              address,
              walletKind: "eoa",
              chainId: chainId ?? undefined,
              walletProvider: "privy",    // surfaces in user_state
              authMethod: undefined,      // fill if you expose login method
            }
          : {
              ...AOMI_SESSION_DISCONNECTED_IDENTITY,
              chainId: chainId ?? undefined,
            };

      return {
        identity,
        isReady: ready,
        isSwitchingChain: false,
        canConnect: ready && !authenticated,
        canOpenAccountUI: false,
        canDisconnect: authenticated,

        connect: async () => { login(); },
        disconnect: async () => { logout(); },

        switchChain: switchChainAsync
          ? async (nextChainId: number) => {
              await switchChainAsync({ chainId: nextChainId });
            }
          : undefined,

        // EVM transaction — RuntimeTxHandler calls this for kind:"transaction"
        sendTransaction: sendTransactionAsync
          ? async (payload: WalletTxPayload) => {
              // Simple EOA path — single call, no AA
              const hash = await sendTransactionAsync({
                to: payload.to as `0x${string}`,
                value: payload.value ? BigInt(payload.value) : undefined,
                data: payload.data as `0x${string}` | undefined,
                chainId: payload.chainId ?? chainId,
              });
              return { txHash: hash };
            }
          : undefined,

        // EIP-712 signing — RuntimeTxHandler calls this for kind:"eip712_sign"
        signTypedData: signTypedDataAsync
          ? async (payload: WalletEip712Payload) => {
              const signArgs = toViemSignTypedDataArgs(payload);
              if (!signArgs) throw new Error("Missing typed_data payload");
              const signature = await signTypedDataAsync(signArgs as any);
              return { signature };
            }
          : undefined,

        // signSolanaTransaction: undefined — omit if Krexa is EVM-only
      };
    }, [
      ready, authenticated, address, chainId, isConnected,
      sendTransactionAsync, signTypedDataAsync, switchChainAsync,
      login, logout,
    ]);

    return (
      <AomiWalletKitContextProvider value={adapter}>
        {children}
      </AomiWalletKitContextProvider>
    );
  }

  3. What This Gets Them

  Once mounted, the data flow becomes:

  Krexa Privy login → wagmi hooks → KrexaPrivyAdapter (builds AomiWalletKit)
    → AomiWalletKitContextProvider (context)
      → AomiWalletKitSync (auto-syncs identity → setUser → user_state)
        → RuntimeTxHandler reads pendingWalletRequests + calls adapter.sendTransaction
          → wagmi sendTransactionAsync (Krexa's Privy signer)
            → session.resolve(id, result) → backend

  - User connects once at the Krexa level — the agent sees the wallet immediately
  - AI-initiated transactions pop Privy's signing modal (same wallet, same session)
  - user_state.wallet_provider = "privy" is sent to the backend on every chat message

  4. Batch / AA Support (Optional)

  The simple adapter above does single-call EOA sends. If Krexa wants batch transactions or AA (4337), they
   should use the shared execution engine instead of raw sendTransactionAsync:

  import { executeWalletKitTransaction } from "@aomi-labs/widget";
  // ...inside the adapter useMemo:
  sendTransaction: async (payload: WalletTxPayload) => {
    return executeWalletKitTransaction({
      payload,
      state: {
        currentChainId: chainId,
        capabilities,             // from useCapabilities()
        sendCallsSyncAsync,       // from useSendCallsSync() if supported
        sendTransactionAsync,
        switchChainAsync,
        chainsById,               // Record<number, Chain>
      },
    });
  },

  This gives them the full fallback chain: 7702 → 4337 → EOA, batch wallet_sendCalls, and fee injection
  from RuntimeTxHandler's simulation step — all using Krexa's Privy signer.
