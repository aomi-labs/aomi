"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import {
  fetchGitHubSession,
  type GitHubSessionInfo,
} from "@/features/deploy/dashboard";

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

export function signedOutGitHubAccount(): GitHubAccountState {
  return signedOutState;
}

export function GitHubSessionProvider({ children }: { children: ReactNode }) {
  const [account, setAccount] = useState<GitHubAccountState>(initialState);

  useEffect(() => {
    let cancelled = false;
    fetchGitHubSession().then((session) => {
      if (!cancelled) setAccount({ ...session, loading: false });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const expire = () =>
      setAccount((current) =>
        current.signedIn ? { ...current, expired: true } : current,
      );
    window.addEventListener(BUILD_SESSION_EXPIRED, expire);
    return () => window.removeEventListener(BUILD_SESSION_EXPIRED, expire);
  }, []);

  useEffect(() => {
    if (!account.expired) return;
    let cancelled = false;
    const resume = () => {
      void fetchGitHubSession().then((session) => {
        if (!cancelled && session.signedIn) {
          setAccount({ ...session, loading: false });
        }
      });
    };
    window.addEventListener("focus", resume);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", resume);
    };
  }, [account.expired]);

  const value = useMemo(
    () => ({
      account,
      setAccount,
    }),
    [account],
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
