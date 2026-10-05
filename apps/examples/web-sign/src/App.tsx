import {
  Aomi,
  Session,
  commitCapabilities,
  walletCapabilities,
  walletUserState,
  type CommitRecoveryRecord,
  type CommitRecoveryStore,
} from "@aomi-labs/client";
import { useEffect, useState } from "react";
import { erc20Abi } from "viem";

import { Chat } from "./Chat";
import { InjectedWallet } from "./injected-wallet";

const env = import.meta.env;
const baseUrl = env.VITE_AOMI_BASE_URL?.trim() || "https://chat.aomi.dev";
const applicationId = env.VITE_AOMI_APPLICATION_ID?.trim()
  ? Number(env.VITE_AOMI_APPLICATION_ID)
  : undefined;
const allowedTargets = (env.VITE_ALLOWED_TARGETS ?? "")
  .split(",")
  .map((address) => address.trim().toLowerCase())
  .filter(Boolean);

// With no `auth` option the SDK signs in as a guest. From a third-party origin
// it requests an origin-bound widget session (POST /api/auth/widget/guest) and
// sends it as a Bearer token, so no cookies or OAuth client are needed.
const aomi = new Aomi({ baseUrl });

/**
 * Remembers in-flight wallet sends for durable (Commit Service) transactions,
 * so a page reload reconciles an already-sent transaction instead of
 * prompting the wallet a second time.
 */
class LocalCommitRecovery implements CommitRecoveryStore {
  load(threadId: string, commitId: string): CommitRecoveryRecord | undefined {
    try {
      const value = localStorage.getItem(this.key(threadId, commitId));
      return value ? (JSON.parse(value) as CommitRecoveryRecord) : undefined;
    } catch {
      return undefined;
    }
  }

  save(threadId: string, commitId: string, record: CommitRecoveryRecord) {
    localStorage.setItem(this.key(threadId, commitId), JSON.stringify(record));
  }

  remove(threadId: string, commitId: string) {
    localStorage.removeItem(this.key(threadId, commitId));
  }

  private key(threadId: string, commitId: string) {
    return `aomi-web-sign:commit:${threadId}:${commitId}`;
  }
}

export function App() {
  const [wallet, setWallet] = useState<InjectedWallet>();
  const [session, setSession] = useState<Session>();
  const [error, setError] = useState<string>();
  const [, setChainId] = useState<number>();

  // One Agent session per connected account. The SDK's Session streams the
  // conversation and owns every Action; it is the same primitive that
  // @aomi-labs/react builds on.
  useEffect(() => {
    if (!wallet) return;
    const wallets = wallet.toAomiWallets();
    const next = new Session(aomi.raw, {
      // Omit `target` for the default Agent routing; pin an App with
      // `{ mode: "direct", applicationId }`.
      ...(applicationId
        ? { target: { mode: "direct" as const, applicationId } }
        : {}),
      actions: walletCapabilities(wallets),
      commits: commitCapabilities(wallets, new LocalCommitRecovery()),
      // Tells the agent which address and chain it is building for.
      getUserState: () => walletUserState(wallets),
    });
    setSession(next);
    const unwatch = wallet.watch((change) =>
      change === "account" ? setWallet(undefined) : setChainId(wallet.chainId),
    );
    return () => {
      unwatch();
      next.close();
      setSession(undefined);
    };
  }, [wallet]);

  return (
    <main>
      <header>
        <h1>Aomi web-sign example</h1>
        <p className="muted">
          Chat with the Aomi agent; review, verify, and sign its transactions
          with your own wallet.
        </p>
        {wallet ? (
          <p className="wallet">
            <code>{wallet.address}</code> on chain {wallet.chainId}
            <button type="button" onClick={() => setWallet(undefined)}>
              Disconnect
            </button>
          </p>
        ) : (
          <button
            type="button"
            onClick={() => {
              setError(undefined);
              InjectedWallet.connect().then(setWallet, (reason: unknown) =>
                setError(
                  reason instanceof Error ? reason.message : String(reason),
                ),
              );
            }}
          >
            Connect wallet
          </button>
        )}
        {error && <p className="error">{error}</p>}
      </header>
      {wallet && session && (
        <Chat
          session={session}
          wallet={wallet}
          allowedTargets={allowedTargets}
          // Extend with your own contracts' ABIs to decode their calls.
          abi={erc20Abi}
        />
      )}
    </main>
  );
}
