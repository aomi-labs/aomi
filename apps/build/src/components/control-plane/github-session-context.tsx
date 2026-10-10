"use client";

import {
  createContext,
  useContext,
  useCallback,
  useRef,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import {
  fetchGitHubSession,
  type GitHubSessionInfo,
} from "@/features/deploy/dashboard";

import { useQueryClient, type QueryClient } from "@tanstack/react-query";

import { BUILD_SESSION_EXPIRED } from "@/lib/session-expiry";

export type GitHubAccountState = GitHubSessionInfo & {
  loading: boolean;
  expired?: boolean;
};

type GitHubSessionContextValue = {
  account: GitHubAccountState;
  setAccount: (account: GitHubAccountState) => void;
};

const signedOutState: GitHubAccountState = {
  loading: false,
  signedIn: false,
  githubLogin: null,
  githubAvatarUrl: null,
  installationId: null,
};

const initialState: GitHubAccountState = {
  ...signedOutState,
  loading: true,
};

const GitHubSessionContext = createContext<GitHubSessionContextValue | null>(
  null,
);

// A router cache can outlive this layout. Retain its confirmed identity so a
// same-account remount reuses reads, while an account change clears all families.
const accountScopes = new WeakMap<QueryClient, string>();

export function signedOutGitHubAccount(): GitHubAccountState {
  return signedOutState;
}

export function GitHubSessionProvider({ children }: { children: ReactNode }) {
  const [account, updateAccount] = useState<GitHubAccountState>(initialState);
  const currentAccount = useRef(initialState);
  const sessionEpoch = useRef(0);
  const queryClient = useQueryClient();

  const clearAccountQueries = useCallback(() => {
    // Attempts and runtime reads use key families outside `aomi-build`.
    void queryClient.cancelQueries();
    queryClient.clear();
  }, [queryClient]);

  const setAccount = useCallback(
    (
      value:
        | GitHubAccountState
        | ((current: GitHubAccountState) => GitHubAccountState),
    ) => {
      const previous = currentAccount.current;
      const next = typeof value === "function" ? value(previous) : value;
      if (next === previous) return;
      if (!next.loading) {
        const scope = JSON.stringify([
          next.signedIn,
          next.githubLogin,
          next.installationId ?? null,
        ]);
        if (accountScopes.get(queryClient) !== scope) clearAccountQueries();
        accountScopes.set(queryClient, scope);
      }
      sessionEpoch.current += 1;
      currentAccount.current = next;
      updateAccount(next);
    },
    [clearAccountQueries, queryClient],
  );

  useEffect(() => {
    let cancelled = false;
    const epoch = sessionEpoch.current;
    fetchGitHubSession().then((session) => {
      if (!cancelled && epoch === sessionEpoch.current)
        setAccount({ ...session, loading: false });
    });
    return () => {
      cancelled = true;
    };
  }, [setAccount]);

  useEffect(() => {
    const expire = () =>
      setAccount((current) =>
        current.signedIn ? { ...current, expired: true } : current,
      );
    window.addEventListener(BUILD_SESSION_EXPIRED, expire);
    return () => window.removeEventListener(BUILD_SESSION_EXPIRED, expire);
  }, [setAccount]);

  useEffect(() => {
    if (!account.expired) return;
    let cancelled = false;
    const resume = () => {
      const epoch = sessionEpoch.current;
      void fetchGitHubSession().then((session) => {
        if (!cancelled && epoch === sessionEpoch.current && session.signedIn) {
          setAccount({ ...session, loading: false });
        }
      });
    };
    window.addEventListener("focus", resume);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", resume);
    };
  }, [account.expired, setAccount]);

  const value = useMemo(
    () => ({
      account,
      setAccount,
    }),
    [account, setAccount],
  );

  return (
    <GitHubSessionContext.Provider value={value}>
      {children}
    </GitHubSessionContext.Provider>
  );
}

export function useGitHubSession() {
  const context = useContext(GitHubSessionContext);
  if (!context) {
    throw new Error(
      "useGitHubSession must be used inside GitHubSessionProvider",
    );
  }
  return context;
}
