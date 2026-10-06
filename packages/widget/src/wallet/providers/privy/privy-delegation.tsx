"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  useModalStatus,
  usePrivy,
  useSessionSigners,
} from "@privy-io/react-auth";
import { PrivyDelegationContext } from "./privy-delegation-context";

type EmbeddedEvmWallet = {
  address: string;
  id: string;
  chainType?: string;
  imported?: boolean;
  walletClientType?: string;
};

type PendingDelegation = {
  id: number;
  state: string;
  signerId: string;
  resolve: () => void;
  reject: (error: Error) => void;
};

function embeddedEvmWallet(user: unknown): EmbeddedEvmWallet | null {
  if (!user || typeof user !== "object") return null;
  const record = user as { wallet?: unknown; linkedAccounts?: unknown[] };
  const candidates = [record.wallet, ...(record.linkedAccounts ?? [])];
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "object") continue;
    const wallet = candidate as Partial<EmbeddedEvmWallet>;
    if (
      typeof wallet.id === "string" &&
      typeof wallet.address === "string" &&
      /^0x[0-9a-fA-F]{40}$/.test(wallet.address) &&
      wallet.imported !== true &&
      (wallet.chainType === undefined ||
        wallet.chainType === "ethereum" ||
        wallet.chainType === "evm") &&
      (wallet.walletClientType === undefined ||
        wallet.walletClientType === "privy" ||
        wallet.walletClientType === "privy-v2")
    ) {
      return wallet as EmbeddedEvmWallet;
    }
  }
  return null;
}

/**
 * Owns the one-time Auto-mode consent ceremony inside the same Privy context
 * that owns Alice's embedded wallet. The user explicitly adds Aomi's signer;
 * the callback then proves the wallet and persists the provider grant.
 */
export function PrivyDelegationProvider({
  callbackPath = "/api/delegation/privy/callback",
  children,
}: {
  callbackPath?: string;
  children: ReactNode;
}) {
  const { authenticated, getAccessToken, login, ready, user } = usePrivy();
  const { addSessionSigners } = useSessionSigners();
  const { isOpen: modalOpen } = useModalStatus();
  const [pending, setPending] = useState<PendingDelegation | null>(null);
  const pendingRef = useRef<PendingDelegation | null>(null);
  const sequence = useRef(0);
  const loginStarted = useRef<number | null>(null);
  const signerStarted = useRef<number | null>(null);
  const modalWasOpen = useRef(false);

  const settle = useCallback((id: number, error?: Error) => {
    const operation = pendingRef.current;
    if (!operation || operation.id !== id) return;
    pendingRef.current = null;
    setPending(null);
    if (error) operation.reject(error);
    else operation.resolve();
  }, []);

  const openLogin = useCallback(
    (operation: PendingDelegation) => {
      if (loginStarted.current === operation.id) return;
      loginStarted.current = operation.id;
      try {
        login();
      } catch (error) {
        settle(
          operation.id,
          error instanceof Error
            ? error
            : new Error("Privy sign-in could not be opened."),
        );
      }
    },
    [login, settle],
  );

  const start = useCallback(
    ({ signerId, state }: { state: string; signerId: string }) =>
      new Promise<void>((resolve, reject) => {
        if (pendingRef.current) {
          reject(new Error("A Privy delegation is already in progress."));
          return;
        }
        const operation: PendingDelegation = {
          id: ++sequence.current,
          state,
          signerId,
          resolve,
          reject,
        };
        pendingRef.current = operation;
        setPending(operation);
        if (ready && !authenticated) openLogin(operation);
      }),
    [authenticated, openLogin, ready],
  );

  useEffect(() => {
    if (!pending) {
      modalWasOpen.current = false;
      return;
    }
    if (modalOpen) {
      modalWasOpen.current = true;
      return;
    }
    if (modalWasOpen.current && !authenticated) {
      modalWasOpen.current = false;
      settle(pending.id, new Error("Privy sign-in was dismissed."));
    }
  }, [authenticated, modalOpen, pending, settle]);

  useEffect(() => {
    if (!pending || !ready) return;
    if (!authenticated) {
      openLogin(pending);
      return;
    }
    if (signerStarted.current === pending.id) return;
    const wallet = embeddedEvmWallet(user);
    if (!wallet) {
      settle(
        pending.id,
        new Error("Privy did not create an embedded Ethereum wallet."),
      );
      return;
    }
    signerStarted.current = pending.id;
    void (async () => {
      let signerError: unknown;
      try {
        try {
          await addSessionSigners({
            address: wallet.address,
            signers: [{ signerId: pending.signerId, policyIds: [] }],
          });
        } catch (error) {
          // An already-installed signer can be returned as an error. The
          // backend callback is authoritative, so still let it verify state.
          signerError = error;
        }
        const accessToken = await getAccessToken();
        if (!accessToken || !user?.id) {
          throw new Error("Privy did not provide an access token.");
        }
        const response = await fetch(callbackPath, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            state: pending.state,
            access_token: accessToken,
            user_id: user.id,
            wallets: [
              {
                id: wallet.id,
                address: wallet.address,
                chain_type: "ethereum",
              },
            ],
          }),
        });
        if (!response.ok) {
          const because =
            signerError instanceof Error
              ? ` Privy also rejected the signer: ${signerError.message}`
              : "";
          throw new Error(
            `Aomi could not save the delegation (HTTP ${response.status}).${because}`,
          );
        }
        settle(pending.id);
      } catch (error) {
        settle(
          pending.id,
          error instanceof Error
            ? error
            : new Error("Privy delegation failed."),
        );
      }
    })();
  }, [
    addSessionSigners,
    authenticated,
    callbackPath,
    getAccessToken,
    openLogin,
    pending,
    ready,
    settle,
    user,
  ]);

  useEffect(() => {
    if (!pending || ready) return;
    const timer = globalThis.setTimeout(
      () =>
        settle(
          pending.id,
          new Error(
            "Privy is still loading. Check browser privacy settings and try again.",
          ),
        ),
      12_000,
    );
    return () => globalThis.clearTimeout(timer);
  }, [pending, ready, settle]);

  return (
    <PrivyDelegationContext.Provider value={{ start }}>
      {children}
    </PrivyDelegationContext.Provider>
  );
}
