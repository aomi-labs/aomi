"use client";

import {
  createContext,
  Fragment,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import {
  fetchGitHubSession,
  type GitHubSessionInfo,
} from "@build/features/launch/dashboard";

import { BUILD_SESSION_EXPIRED } from "@build/lib/session-expiry";

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
  const [account, setAccountState] = useState<GitHubAccountState>(initialState);
  const principalRef = useRef<string | null | undefined>(undefined);
  const [scopeRevision, setScopeRevision] = useState(0);
  const setAccount = useCallback((next: GitHubAccountState) => {
    if (!next.loading) {
      const principal = next.signedIn
        ? (next.githubLogin?.trim().toLowerCase() ?? null)
        : null;
      if (
        principalRef.current !== undefined &&
        principalRef.current !== principal
      ) {
        setScopeRevision((revision) => revision + 1);
      }
      principalRef.current = principal;
    }
    setAccountState(next);
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchGitHubSession().then((session) => {
      if (!cancelled) setAccount({ ...session, loading: false });
    });
    return () => {
      cancelled = true;
    };
  }, [setAccount]);

  useEffect(() => {
    const expire = () =>
      setAccountState((current) =>
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
      <Fragment key={scopeRevision}>{children}</Fragment>
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
