"use client";

import "@aomi-labs/widget-lib/providers/para";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAomiWalletKit } from "@aomi-labs/widget-lib";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "wagmi/chains";

type AccountSnapshot = unknown;

const testWalletOne = privateKeyToAccount(
  "0x59c6995e998f97a5a004497e5daeda6de8e6d222a939503eec87a6e0e17dc66b",
);
const testWalletTwo = privateKeyToAccount(
  "0x5de4111afa1a4b4a3f0bd92d46db4a8eeb68d5e6b1bb8a48e9e025f1e67b2f6d",
);
const testChainId = sepolia.id;

export function WidgetAuthE2EClient() {
  return <WidgetAuthE2EPanel />;
}

function WidgetAuthE2EPanel() {
  const walletKit = useAomiWalletKit();
  const [accountSnapshot, setAccountSnapshot] = useState<AccountSnapshot>(null);
  const [log, setLog] = useState<string[]>([]);
  const [pending, setPending] = useState<string | null>(null);

  const pushLog = useCallback((message: string) => {
    setLog((current) => [
      `${new Date().toISOString().slice(11, 19)} ${message}`,
      ...current.slice(0, 19),
    ]);
  }, []);

  const refreshAccount = useCallback(async () => {
    try {
      const response = await fetch("/v1/account", {
        credentials: "include",
      });
      setAccountSnapshot(await response.json());
    } catch (error) {
      setAccountSnapshot({
        error: error instanceof Error ? error.message : "refresh failed",
      });
    }
  }, []);

  useEffect(() => {
    void refreshAccount();
  }, [refreshAccount]);

  const run = useCallback(
    async (label: string, action: () => Promise<void>) => {
      setPending(label);
      try {
        await action();
        pushLog(`${label}: ok`);
      } catch (error) {
        pushLog(
          `${label}: ${
            error instanceof Error ? error.message : "unknown error"
          }`,
        );
      } finally {
        await refreshAccount();
        setPending(null);
      }
    },
    [pushLog, refreshAccount],
  );

  const summary = useMemo(
    () => ({
      identity: walletKit.identity,
      accountStatus: walletKit.accountStatus,
      accountUser: walletKit.accountUser,
      linkedAccounts: walletKit.accountLinkedAccounts,
      accountWallets: walletKit.accountWallets,
      accounts: walletKit.accounts,
      walletModalRows: walletKit.walletModalRows,
    }),
    [walletKit],
  );

  const walletIds = walletKit.accountWallets?.map((wallet) => wallet.id) ?? [];

  const signInWithTestWallet = useCallback(async () => {
    const nonceResponse = await fetch("/api/auth/siwe/nonce", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({}),
    });
    const { nonce } = await readJsonOrThrow<{ nonce: string }>(
      nonceResponse,
      "SIWE nonce",
    );
    const message = buildSiweMessage({
      address: testWalletOne.address,
      chainId: testChainId,
      nonce,
    });
    const signature = await testWalletOne.signMessage({ message });
    const verifyResponse = await fetch("/api/auth/siwe/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        message,
        signature,
      }),
    });
    if (!verifyResponse.ok) {
      await readJsonOrThrow(verifyResponse, "SIWE verify");
    }
    window.setTimeout(() => window.location.reload(), 250);
  }, []);

  const exchangeProviderToken = useCallback(async () => {
    const credential = await walletKit.getAccountCredential?.();
    if (!credential) {
      throw new Error("Para did not return a credential");
    }
    const exchangePath = walletKit.accountUser
      ? "/v1/account/provider/exchange"
      : "/api/auth/aomi/provider/exchange";
    const response = await fetch(exchangePath, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        provider: credential.provider,
        tokenKind: credential.tokenKind,
        providerToken: credential.providerToken,
      }),
    });
    const body = await readJsonOrThrow(response, "Para provider exchange");
    pushLog(`provider exchange response: ${JSON.stringify(body)}`);
  }, [pushLog, walletKit]);

  const linkSecondTestWallet = useCallback(async () => {
    const nonceResponse = await fetch(
      `/v1/account/wallets/link?address=${encodeURIComponent(
        testWalletTwo.address,
      )}&chainId=${encodeURIComponent(String(testChainId))}`,
      {
        method: "GET",
        credentials: "include",
      },
    );
    const { nonce } = await readJsonOrThrow<{ nonce: string }>(
      nonceResponse,
      "wallet link nonce",
    );
    const message = buildWalletLinkMessage({
      address: testWalletTwo.address,
      chainId: testChainId,
      nonce,
    });
    const signature = await testWalletTwo.signMessage({ message });
    const response = await fetch("/v1/account/wallets/link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        family: "evm",
        address: testWalletTwo.address,
        chainId: testChainId,
        nonce,
        message,
        signature,
      }),
    });
    const body = await response.json();
    if (!response.ok) {
      throw new Error(`wallet link failed: ${response.status}`);
    }
    pushLog(`link second wallet response: ${JSON.stringify(body)}`);
  }, [pushLog]);

  return (
    <main className="h-screen overflow-auto bg-white p-6 text-sm text-slate-950">
      <section className="mx-auto flex max-w-6xl flex-col gap-4">
        <header>
          <h1 className="text-2xl font-semibold">Widget Auth E2E</h1>
          <p className="text-slate-600">
            Para + account-backend harness for local verification.
          </p>
        </header>

        <div className="flex flex-wrap gap-2">
          <button
            className="rounded border px-3 py-2"
            disabled={!!pending}
            onClick={() =>
              void run("para google login", async () => {
                await walletKit.connectSocial?.("google");
              })
            }
          >
            Para Google Login
          </button>
          <button
            className="rounded border px-3 py-2"
            disabled={!!pending}
            onClick={() =>
              void run("open account ui", async () => {
                await walletKit.openAccountUI?.({ family: "evm" });
              })
            }
          >
            Open Para Account UI
          </button>
          <button
            className="rounded border px-3 py-2"
            disabled={!!pending}
            onClick={() =>
              void run("refresh", async () => {
                await refreshAccount();
              })
            }
          >
            Refresh
          </button>
          <button
            className="rounded border px-3 py-2"
            disabled={!!pending}
            onClick={() => void run("test SIWE sign-in", signInWithTestWallet)}
          >
            Test SIWE Sign In
          </button>
          <button
            className="rounded border px-3 py-2"
            disabled={!!pending}
            onClick={() =>
              void run("link second test wallet", linkSecondTestWallet)
            }
          >
            Link 2nd Test Wallet
          </button>
          <button
            className="rounded border px-3 py-2"
            disabled={!!pending}
            onClick={() =>
              void run("exchange provider token", exchangeProviderToken)
            }
          >
            Exchange Para Token
          </button>
          <button
            className="rounded border px-3 py-2"
            disabled={!!pending}
            onClick={() =>
              void run("provider logout", async () => {
                await walletKit.disconnect?.({
                  family: "all",
                  providerSignOut: true,
                });
              })
            }
          >
            Provider Logout
          </button>
          <button
            className="rounded border px-3 py-2"
            disabled={!!pending}
            onClick={() =>
              void run("betterauth signout", async () => {
                await fetch("/api/auth/sign-out", {
                  method: "POST",
                  credentials: "include",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({}),
                });
              })
            }
          >
            BetterAuth Sign Out
          </button>
          <button
            className="rounded border border-red-300 px-3 py-2 text-red-700"
            disabled={!!pending}
            onClick={() =>
              void run("delete account", async () => {
                await walletKit.deleteAccount?.();
              })
            }
          >
            Delete Account
          </button>
        </div>

        {walletIds.length ? (
          <div className="flex flex-wrap gap-2">
            {walletIds.map((walletId) => (
              <button
                key={walletId}
                className="rounded border px-3 py-2"
                disabled={!!pending}
                onClick={() =>
                  void run(`unlink ${walletId}`, async () => {
                    await walletKit.unlinkLinkedWallet?.(walletId);
                  })
                }
              >
                Unlink {walletId.slice(0, 8)}
              </button>
            ))}
          </div>
        ) : null}

        {pending ? <div data-testid="pending">Pending: {pending}</div> : null}

        <div className="grid gap-4 lg:grid-cols-2">
          <StateBlock title="Wallet Kit" value={summary} />
          <StateBlock title="Backend Account" value={accountSnapshot} />
        </div>

        <section>
          <h2 className="mb-2 text-lg font-semibold">Log</h2>
          <pre className="min-h-24 overflow-auto rounded border bg-slate-50 p-3">
            {log.join("\n")}
          </pre>
        </section>
      </section>
    </main>
  );
}

function buildSiweMessage(input: {
  address: string;
  chainId: number;
  nonce: string;
}) {
  const origin = window.location.origin;
  const domain = window.location.host;
  return `${domain} wants you to sign in with your Ethereum account:
${input.address}

Sign in to Aomi.

URI: ${origin}
Version: 1
Chain ID: ${input.chainId}
Nonce: ${input.nonce}
Issued At: ${new Date().toISOString()}`;
}

function buildWalletLinkMessage(input: {
  address: string;
  chainId: number;
  nonce: string;
}) {
  return `${window.location.host} wants to link this wallet to your Aomi account:
${input.address}

Only sign this message if you want this wallet attached to the current Aomi account.

URI: ${window.location.origin}
Version: 1
Chain ID: ${input.chainId}
Nonce: ${input.nonce}
Issued At: ${new Date().toISOString()}`;
}

async function readJsonOrThrow<T = unknown>(
  response: Response,
  label: string,
): Promise<T> {
  const text = await response.text();
  const body = text ? (JSON.parse(text) as T) : null;
  if (!response.ok) {
    throw new Error(`${label} failed: ${response.status} ${text}`);
  }
  return body as T;
}

function StateBlock({ title, value }: { title: string; value: unknown }) {
  return (
    <section>
      <h2 className="mb-2 text-lg font-semibold">{title}</h2>
      <pre className="max-h-[520px] overflow-auto rounded border bg-slate-50 p-3 text-xs">
        {JSON.stringify(value, null, 2)}
      </pre>
    </section>
  );
}
