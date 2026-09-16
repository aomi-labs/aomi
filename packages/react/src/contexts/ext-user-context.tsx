"use client";

import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { UserState } from "@aomi-labs/client";

export { UserState } from "@aomi-labs/client";

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as UnknownRecord;
}

function mergeRecords(
  previous: UnknownRecord,
  incoming: UnknownRecord,
): UnknownRecord {
  const next: UnknownRecord = { ...previous };
  for (const [key, value] of Object.entries(incoming)) {
    const prevRecord = asRecord(next[key]);
    const incomingRecord = asRecord(value);
    if (prevRecord && incomingRecord) {
      next[key] = mergeRecords(prevRecord, incomingRecord);
    } else if (value !== undefined) {
      next[key] = value;
    }
  }
  return next;
}

function dropWalletBlocks(state: UserState): UserState {
  const chainId = UserState.chainId(state);
  return {
    connection: { is_connected: false },
    ...(chainId === undefined ? {} : { evm: { chain_id: chainId } }),
    ...(state.ext === undefined ? {} : { ext: state.ext }),
    ...(state.preferences === undefined
      ? {}
      : { preferences: state.preferences }),
  };
}

function dropAddressScopedState(state: UserState): UserState {
  const evm = asRecord(state.evm);
  const nextEvm = evm ? { ...evm } : undefined;
  if (nextEvm) {
    delete nextEvm.ens_name;
  }

  const next: UserState = { ...state };
  if (nextEvm && Object.keys(nextEvm).length > 0) {
    next.evm = nextEvm;
  } else {
    delete next.evm;
  }
  return next;
}

function stableStateString(state: UserState): string {
  return JSON.stringify(state);
}

type UserContextValue = {
  user: UserState;
  setUser: (data: Partial<UserState>) => void;
  addExtValue: (key: string, value: unknown) => void;
  removeExtValue: (key: string) => void;
  getUserState: () => UserState;
};

const UserContext = createContext<UserContextValue | undefined>(undefined);

export function useUser() {
  const context = useContext(UserContext);
  if (!context) {
    throw new Error("useUser must be used within ExtUserProvider");
  }
  // Return only the public API
  return {
    user: context.user,
    setUser: context.setUser,
    addExtValue: context.addExtValue,
    removeExtValue: context.removeExtValue,
    getUserState: context.getUserState,
  };
}

// ==================== Provider ====================

/**
 * Idempotent provider: if a parent already provided `UserContext`, render
 * children straight through. Otherwise mount a fresh store.
 *
 * The widget layers (`AomiFrame.Root` / `AomiRuntime`) and the wallet-kit
 * wallet-kit layers may both want to be
 * usable standalone. Each historically wrapped with `<ExtUserProvider>` —
 * but when they nest, the inner provider created a *second* store that
 * shadowed the outer. The chat composer would read from one store while
 * `AomiWalletKitSync` wrote to another, so wallet connects never
 * propagated to the chat's `user_state`. Collapsing nested mounts to the
 * outermost store fixes that without forcing host apps to wire the
 * provider themselves.
 */
export function ExtUserProvider({ children }: { children: ReactNode }) {
  const parent = useContext(UserContext);
  if (parent) {
    return <>{children}</>;
  }
  return <ExtUserProviderImpl>{children}</ExtUserProviderImpl>;
}

function ExtUserProviderImpl({ children }: { children: ReactNode }) {
  const [user, setUserState] = useState<UserState>({
    connection: { is_connected: false },
  });

  // Refs for stable getter functions
  const userRef = useRef(user);
  userRef.current = user;

  const setUser = useCallback((data: Partial<UserState>) => {
    setUserState((prev) => {
      const incoming = data as UserState;
      const merged = mergeRecords(prev, incoming) as UserState;
      // Submitter choice belongs to the selected account, not its connector
      // or chain. Wallet switches must not inherit the previous Auto route.
      for (const chain of ["evm", "svm"] as const) {
        const wallet = incoming[chain];
        const before = prev[chain];
        const after = merged[chain];
        if (!wallet || !after) continue;
        const changed =
          wallet.address &&
          before?.address &&
          !UserState.sameAddress(
            { chain, address: wallet.address },
            { chain, address: before.address },
          );
        if (
          (changed && !Object.hasOwn(wallet, "broadcaster")) ||
          (Object.hasOwn(wallet, "broadcaster") &&
            wallet.broadcaster === undefined)
        ) {
          delete after.broadcaster;
        }
      }

      // Wallet-context fields belong to a specific connected session. On
      // disconnect we wipe identity, AA, and sponsorship so that the next
      // connection cannot inherit state from the previous wallet. The
      // selected chain is a wallet-independent read preference, so keep it
      // available to chat and read-only tools while disconnected.
      let next: UserState;
      if (UserState.isConnected(incoming) === false) {
        next = dropWalletBlocks(merged);
      } else {
        // Address change while staying connected (wallet switch in place):
        // Per-tx AA outputs belong to the prior address. Pending requests stay
        // until their backend callback resolves or rejects them.
        const prevAddress = UserState.address(prev);
        const nextAddress = UserState.address(merged);
        const addressChanged =
          prevAddress !== undefined &&
          nextAddress !== undefined &&
          prevAddress.toLowerCase() !== nextAddress.toLowerCase();
        next = addressChanged ? dropAddressScopedState(merged) : merged;
      }

      if (stableStateString(prev) === stableStateString(next)) {
        return prev;
      }

      return next;
    });
  }, []);

  const addExtValue = useCallback((key: string, value: unknown) => {
    setUserState((prev) => {
      const next = UserState.withExt(prev, key, value);
      return next;
    });
  }, []);

  const removeExtValue = useCallback((key: string) => {
    setUserState((prev) => {
      const ext = prev.ext;
      if (
        typeof ext !== "object" ||
        ext === null ||
        Array.isArray(ext) ||
        !(key in ext)
      ) {
        return prev;
      }
      const nextExt = { ...(ext as Record<string, unknown>) };
      delete nextExt[key];
      const next: UserState = {
        ...prev,
        ext: Object.keys(nextExt).length > 0 ? nextExt : undefined,
      };
      return next;
    });
  }, []);

  // Stable getters that runtime classes can call
  const getUserState = useCallback(() => userRef.current, []);

  return (
    <UserContext.Provider
      value={{
        user,
        setUser,
        addExtValue,
        removeExtValue,
        getUserState,
      }}
    >
      {children}
    </UserContext.Provider>
  );
}
