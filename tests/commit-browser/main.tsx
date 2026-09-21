import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import {
  CommitController,
  commitCapabilities,
  type CommitRecoveryRecord,
  type CommitView,
  type SignableCommit,
} from "../../packages/client/src/commits";
import type { AomiClient } from "../../packages/client/src/client";
import { TransactionReview } from "../../apps/shadcn-registry/src/components/activity-sidebar/transaction-review";
import { install, useAomiRuntime } from "./runtime";

type EthereumProvider = {
  isRabby?: boolean;
  request: (input: { method: string; params?: unknown[] }) => Promise<unknown>;
};
type BrowserFixture = {
  extension_mode?: boolean;
  rpc_url?: string;
  view: CommitView;
  views?: CommitView[];
};

const fixture = (await fetch("/__fixture").then((response) =>
  response.json(),
)) as BrowserFixture;
const request = async (
  method: string,
  path: string,
  options?: { body?: unknown },
) => {
  const response = await fetch(path, {
    method,
    headers: { "content-type": "application/json" },
    body: options?.body ? JSON.stringify(options.body) : undefined,
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.code ?? "Commit request failed");
  return body;
};
const bridge = window as unknown as {
  fixtureSign: (id: string, payload: unknown) => Promise<string[]>;
  fixtureBroadcast: (id: string, bytes: string) => Promise<string>;
};
const browserRecovery = {
  load(threadId: string, commitId: string) {
    const value = localStorage.getItem(recoveryKey(threadId, commitId));
    if (!value) return undefined;
    try {
      return JSON.parse(value) as CommitRecoveryRecord;
    } catch {
      return undefined;
    }
  },
  save(threadId: string, commitId: string, record: CommitRecoveryRecord) {
    localStorage.setItem(
      recoveryKey(threadId, commitId),
      JSON.stringify(record),
    );
  },
  remove(threadId: string, commitId: string) {
    localStorage.removeItem(recoveryKey(threadId, commitId));
  },
};
const attendedCapabilities = {
  sign: async (view: { commit_id: string }, payload: unknown) =>
    bridge.fixtureSign(view.commit_id, payload),
  walletBroadcast: async (view: { commit_id: string }, bytes: string) =>
    bridge.fixtureBroadcast(view.commit_id, bytes),
};
const controller = new CommitController(
  { request } as unknown as AomiClient,
  fixture.view.thread_id,
  fixture.extension_mode
    ? { recovery: browserRecovery }
    : {
        ...attendedCapabilities,
        venueBroadcast: attendedCapabilities.walletBroadcast,
      },
);
install(controller);
for (const view of fixture.views ?? [fixture.view]) controller.ingest(view);

function CommitDriver() {
  const { commits, commitController } = useAomiRuntime();
  const [error, setError] = useState<string>();
  const commit = commits[0];
  if (!commit) return null;
  const label =
    commit.action?.kind === "sign"
      ? "Sign"
      : commit.action?.kind === "broadcast"
        ? "Broadcast"
        : "Continue";
  return (
    <article data-commit-id={commit.commit_id}>
      <p role="status">{commit.state}</p>
      {commit.action && (
        <button
          type="button"
          onClick={() => {
            setError(undefined);
            void commitController
              .execute(commit.commit_id)
              .catch((failure) =>
                setError(
                  failure instanceof Error ? failure.message : "Commit failed",
                ),
              );
          }}
        >
          {label}
        </button>
      )}
      {error && <p role="alert">{error}</p>}
    </article>
  );
}

function BrowserWalletDriver() {
  const { commits, commitController } = useAomiRuntime();
  const [address, setAddress] = useState<string>();
  const [error, setError] = useState<string>();
  const commit = commits.find(
    (candidate) =>
      (candidate.state === "needs_signature" ||
        candidate.state === "awaiting_broadcast") &&
      commitController.review(candidate.commit_id),
  );
  const review = commit ? commitController.review(commit.commit_id) : undefined;

  const connect = async () => {
    setError(undefined);
    try {
      const provider = await rabbyProvider();
      const chainId = Number(fixture.view.chain_ref);
      const chainIdHex = quantity(chainId);
      try {
        await provider.request({
          method: "wallet_addEthereumChain",
          params: [
            {
              chainId: chainIdHex,
              chainName: "Aomi Anvil",
              nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
              rpcUrls: [fixture.rpc_url],
            },
          ],
        });
      } catch (failure) {
        if (!isAlreadyConfigured(failure)) throw failure;
      }
      await provider.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: chainIdHex }],
      });
      const accounts = (await provider.request({
        method: "eth_requestAccounts",
      })) as string[];
      const account = accounts[0];
      if (!account) throw new Error("Rabby returned no account");
      setAddress(account);
      commitController.setCapabilities(
        commitCapabilities(
          {
            evm: {
              address: account,
              switchChain: async (requestedChainId) =>
                provider.request({
                  method: "wallet_switchEthereumChain",
                  params: [{ chainId: quantity(requestedChainId) }],
                }),
              sendPreparedTransaction: (payload) =>
                sendPreparedTransaction(provider, payload),
            },
          },
          browserRecovery,
        ),
      );
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Wallet failed");
    }
  };

  if (!commit || !review)
    return (
      <article data-commit-id={fixture.view.commit_id}>
        <p role="status">
          {commits.every((candidate) => candidate.state === "confirmed")
            ? "confirmed"
            : commits[0]?.state}
        </p>
      </article>
    );

  return (
    <article data-commit-id={commit.commit_id}>
      <button type="button" onClick={() => void connect()}>
        {address ? "Rabby connected" : "Connect Rabby"}
      </button>
      <TransactionReview
        review={{
          id: commit.commit_id,
          revision: commit.review?.revision ?? commit.version,
          request: review,
        }}
        supportedChains={[
          {
            id: Number(commit.chain_ref),
            name: "Aomi Anvil",
            nativeCurrency: { symbol: "ETH" },
          },
        ]}
        approveDisabled={!address || !commitController.canExecute(commit)}
        rejectDisabled={!commit.action}
        onApprove={() =>
          void commitController
            .execute(commit.commit_id)
            .catch((failure) =>
              setError(
                failure instanceof Error ? failure.message : "Commit failed",
              ),
            )
        }
        onReject={() => undefined}
      />
      {error && <p role="alert">{error}</p>}
    </article>
  );
}

function recoveryKey(threadId: string, commitId: string) {
  return `aomi:commit-recovery:${threadId}:${commitId}`;
}

async function rabbyProvider(): Promise<EthereumProvider> {
  const scope = window as typeof window & {
    ethereum?: EthereumProvider & { providers?: EthereumProvider[] };
    rabby?: EthereumProvider;
  };
  if (!scope.ethereum && !scope.rabby)
    await new Promise<void>((resolve) => {
      window.addEventListener("ethereum#initialized", () => resolve(), {
        once: true,
      });
      window.setTimeout(resolve, 2_000);
    });
  const provider =
    scope.rabby ??
    scope.ethereum?.providers?.find((candidate) => candidate.isRabby) ??
    scope.ethereum;
  if (!provider) throw new Error("Rabby provider unavailable");
  return provider;
}

async function sendPreparedTransaction(
  provider: EthereumProvider,
  payload: Extract<SignableCommit, { kind: "evm_transaction" }>,
): Promise<string> {
  const transaction = payload.transaction;
  const hash = await provider.request({
    method: "eth_sendTransaction",
    params: [
      {
        from: payload.signer,
        to: transaction.to,
        data: transaction.data,
        value: quantity(transaction.value),
        gas: quantity(transaction.gas_limit),
        maxFeePerGas: quantity(transaction.max_fee_per_gas),
        maxPriorityFeePerGas: quantity(transaction.max_priority_fee_per_gas),
        nonce: quantity(payload.nonce),
        type: "0x2",
      },
    ],
  });
  if (typeof hash !== "string" || !/^0x[0-9a-f]{64}$/i.test(hash))
    throw new Error("Rabby returned an invalid transaction hash");
  return hash;
}

function quantity(value: string | number): `0x${string}` {
  return `0x${BigInt(value).toString(16)}`;
}

function isAlreadyConfigured(failure: unknown) {
  const code = (failure as { code?: unknown } | undefined)?.code;
  return code === -32602 || code === -32603;
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <main>
      <h1>Commit integration fixture</h1>
      {fixture.extension_mode ? <BrowserWalletDriver /> : <CommitDriver />}
    </main>
  </React.StrictMode>,
);
