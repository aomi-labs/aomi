"use client";

// TEMPORARY visual harness for the Operate pages. All four tabs render the
// REAL OperateView components; window.fetch is stubbed to serve ./fixtures
// (goal-digger: SVM, playground-example: SVM+EVM, geckoterminal: EVM) in the
// exact BFF wire shape. Only the app drill-down remains a design mock.

import { Suspense, useState } from "react";
import { useRouter } from "next/navigation";
import { GitHubSessionProvider } from "@/components/control-plane/github-session-context";
import {
  OperateView,
  type ViewKind,
} from "@/features/operate/operate-view";
import { AppDetailView } from "@/features/operate/app-detail-view";
import {
  ALL_LOGS,
  ALL_TRANSACTIONS,
  APP_NAMES,
  appFixture,
  type LogRecord,
  type TxRecord,
} from "@/features/operate/fixtures";
import {
  exampleAppCards,
  exampleStatement,
} from "@/features/operate/fixtures/wire";

const SOURCE = { id: 141779906, repositoryLink: "aomi-labs/apps", apps: [] };
const SOMM_RECIPIENT = "0x5D907BEa404e6F821d467314a9cA07663CF64c9B";
const SOMM_RECEIPT =
  "0x55e510bb72adb05979adc8afad8c70fa7ca3d0c2cb5dca9432bf82e46ff1df74";

const SOMM_PAYMENTS = {
  available: true,
  scope: "recipient_bucket",
  summary: {
    accruedCredits: 100,
    accruedUsd: 1,
    settledCredits: 100,
    settledUsd: 1,
    outstandingCredits: 0,
    outstandingUsd: 0,
    pricedCalls: 1,
    settlements: 1,
  },
  resources: [
    {
      application: "somm-agent",
      applicationId: 2_936_606,
      tool: "get_idle_assets",
      flatCredits: 100,
      flatUsd: 1,
      beneficiary: "banana_evm",
      recipient: SOMM_RECIPIENT,
      chain: "eip155:84532",
      beneficiaryType: "evm_address",
      observedCalls: 1,
      source: SOURCE,
    },
  ],
  buckets: [
    {
      id: "somm-proof-bucket",
      recipient: SOMM_RECIPIENT,
      outstandingCredits: 0,
      outstandingUsd: 0,
    },
  ],
  events: [
    {
      id: `settle:${SOMM_RECEIPT}`,
      kind: "settlement_confirmed",
      occurredAt: 1_785_119_866,
      application: "somm-agent",
      applicationId: 2_936_606,
      tools: [],
      credits: 100,
      usd: 1,
      asset: "USDC",
      assetAmount: 1,
      recipient: SOMM_RECIPIENT,
      paymentMethod: "coinbase",
      receiptId: SOMM_RECEIPT,
      chain: "eip155:84532",
      explorerUrl: `https://sepolia.basescan.org/tx/${SOMM_RECEIPT}`,
      source: SOURCE,
    },
    {
      id: "usage:somm-proof-fee",
      kind: "fee_accrued",
      occurredAt: 1_785_117_576,
      application: "somm-agent",
      applicationId: 2_936_606,
      tools: ["get_idle_assets"],
      credits: 100,
      usd: 1,
      asset: null,
      assetAmount: null,
      recipient: SOMM_RECIPIENT,
      paymentMethod: "partner",
      receiptId: null,
      chain: null,
      explorerUrl: null,
      source: SOURCE,
    },
  ],
};

const CHAIN_IDS: Record<string, number> = { Ethereum: 1, Base: 8453 };

function txWire(tx: TxRecord) {
  return {
    id: tx.id,
    externalTxId: tx.externalTxId,
    application: tx.app,
    applicationId: appFixture(tx.app)?.meta.applicationId ?? null,
    status: tx.status,
    txHash: tx.hash ?? null,
    chainId: tx.family === "svm" ? 0 : (CHAIN_IDS[tx.chain] ?? 1),
    fromAddress: tx.from,
    toAddress: tx.to,
    value: tx.value,
    hasCalldata: Boolean(tx.calldata),
    calldataPreview: tx.calldata ?? null,
    description: tx.description,
    createdAt: tx.ts,
    updatedAt: tx.ts,
    submittedAt: tx.status === "created" ? null : tx.ts,
    family: tx.family,
    chainName: tx.chain,
    fromLabel: tx.fromLabel,
    toLabel: tx.toLabel,
    valueUsd: tx.valueUsd ?? null,
    block: tx.block ?? null,
    slot: tx.slot ?? null,
    confirmations: tx.confirmations ?? null,
    gasUsed: tx.gasUsed ?? null,
    gasLimit: tx.gasLimit ?? null,
    effGasPrice: tx.effGasPrice ?? null,
    computeUnits: tx.computeUnits ?? null,
    computeLimit: tx.computeLimit ?? null,
    priorityFee: tx.priorityFee ?? null,
    txFee: tx.txFee ?? null,
    platformFee: tx.platformFee ?? null,
    nonce: tx.nonce ?? null,
    method: tx.method ?? null,
    transfers: tx.transfers ?? null,
    revertReason: tx.revertReason ?? null,
    explorerUrl: tx.explorer ?? null,
    source: SOURCE,
  };
}

function logWire(log: LogRecord, index: number) {
  return {
    occurredAt: log.ts,
    eventType: log.eventType ?? "tool_invocation",
    id: `${log.app}-${log.ts}-${index}`,
    application: log.app,
    applicationId: appFixture(log.app)?.meta.applicationId ?? null,
    summary: log.summary,
    details: {},
    kind: log.kind,
    status: log.status,
    tool: log.tool ?? null,
    durationMs: log.durationMs ?? null,
    retries: log.retries ?? null,
    threadId: log.thread ?? null,
    args: log.args ?? null,
    result: log.result ?? null,
    source: SOURCE,
  };
}

const OBSERVABILITY = {
  projects: [SOURCE],
  scope: "owned_applications",
  monitoring: {
    provider: "grafana_prometheus",
    status: "ok",
    windowSeconds: 900,
  },
  dashboardLinks: [
    {
      label: "Open dashboard",
      url: "https://grafana.example.com/d/app",
      scope: "owned_applications",
    },
  ],
  platformMetrics: [],
  apps: [
    {
      applicationId: 2_936_606,
      application: "somm-agent",
      active: true,
      loaded: true,
      releaseTag: "apps-somm-agent-proof",
      sdkVersion: "3.0.3",
      status: "healthy",
      pricing: {
        loadedAt: 1_785_118_000,
        config: {
          version: 1,
          beneficiaries: [
            {
              name: "banana_evm",
              type: "evm_address",
              chain: "eip155:84532",
              value: SOMM_RECIPIENT,
            },
          ],
          resources: {
            get_idle_assets: {
              pricing: { flat: 100 },
              beneficiary: "banana_evm",
            },
          },
          outcome: [],
        },
      },
      metrics: {
        available: true,
        chats24h: 1,
        toolCalls24h: 1,
        transactions24h: 1,
        errorRate: 0,
        toolErrorRate: 0,
        txErrorRate: 0,
        p95LatencyMs: 840,
      },
      source: SOURCE,
    },
    ...exampleAppCards(SOURCE),
  ],
  payments: SOMM_PAYMENTS,
};

const TRANSACTIONS = {
  projects: [SOURCE],
  transactions: [
    {
      id: `partner-payout:${SOMM_RECEIPT}`,
      kind: "partner_payout",
      externalTxId: SOMM_RECEIPT,
      application: "somm-agent",
      applicationId: 2_936_606,
      status: "confirmed",
      txHash: SOMM_RECEIPT,
      chainId: 84532,
      fromAddress: "",
      toAddress: SOMM_RECIPIENT,
      value: "1 USDC",
      hasCalldata: false,
      calldataPreview: null,
      description: "Partner settlement via Coinbase",
      createdAt: 1_785_119_866,
      updatedAt: 1_785_119_866,
      submittedAt: 1_785_119_866,
      family: "evm",
      chainName: "Base Sepolia",
      fromLabel: null,
      toLabel: "beneficiary",
      valueUsd: "$1.00",
      block: null,
      slot: null,
      confirmations: 158,
      gasUsed: null,
      gasLimit: null,
      effGasPrice: null,
      computeUnits: null,
      computeLimit: null,
      priorityFee: null,
      txFee: null,
      platformFee: null,
      nonce: null,
      method: "Coinbase x402",
      transfers: [],
      revertReason: null,
      explorerUrl: `https://sepolia.basescan.org/tx/${SOMM_RECEIPT}`,
      payment: {
        credits: 100,
        recipient: SOMM_RECIPIENT,
        scope: "recipient_bucket",
      },
      source: SOURCE,
    },
    ...ALL_TRANSACTIONS.map(txWire),
  ],
  nextCursor: null,
};

const LOGS = {
  projects: [SOURCE],
  logs: [
    {
      occurredAt: 1_785_119_866,
      eventType: "usage",
      id: `settle:${SOMM_RECEIPT}`,
      application: "somm-agent",
      applicationId: 2_936_606,
      summary: "Partner settlement confirmed · 100 credits",
      details: {
        source: "partner_settlement",
        payment_method: "coinbase",
        recipient: SOMM_RECIPIENT,
        paid_credits: 100,
        receipt_id: SOMM_RECEIPT,
      },
      kind: "event",
      status: "info",
      tool: null,
      durationMs: null,
      retries: null,
      threadId: null,
      args: null,
      result: null,
      source: SOURCE,
    },
    {
      occurredAt: 1_785_117_576,
      eventType: "usage",
      id: "usage:somm-proof-fee",
      application: "somm-agent",
      applicationId: 2_936_606,
      summary: "Partner fee accrued · 100 credits",
      details: {
        source: "partner_fee",
        payment_method: "partner",
        recipient: SOMM_RECIPIENT,
        credits_used: 100,
        billing: {
          items: [
            {
              app: "somm-agent",
              tool: "get_idle_assets",
              kind: "tool_call",
              credits: 100,
              beneficiary: "banana_evm",
              beneficiary_address: SOMM_RECIPIENT,
            },
          ],
        },
      },
      kind: "event",
      status: "info",
      tool: null,
      durationMs: null,
      retries: null,
      threadId: null,
      args: null,
      result: null,
      source: SOURCE,
    },
    ...ALL_LOGS.map(logWire),
  ],
  nextCursor: null,
};

const USAGE = {
  projects: [SOURCE],
  range: { fromDate: "2026-07-01", toDate: "2026-07-15", maxDays: 31 },
  daily: [],
  breakdown: [
    {
      provider: "anthropic",
      model: "claude-opus-4-8",
      paymentMethod: "quota",
      inputTokens: 1_100_000,
      outputTokens: 152_000,
      creditsUsed: 9.1204,
      events: 152,
      source: SOURCE,
    },
    {
      provider: "anthropic",
      model: "claude-haiku-4-5",
      paymentMethod: "quota",
      inputTokens: 206_000,
      outputTokens: 30_300,
      creditsUsed: 1.6233,
      events: 88,
      source: SOURCE,
    },
  ],
  statement: {
    ...exampleStatement(SOURCE),
    payments: SOMM_PAYMENTS,
  },
};

const SESSION = {
  signedIn: true,
  githubLogin: "cecilia",
  githubAvatarUrl: null,
  installationId: 1,
};

function stubFetch() {
  if (typeof window === "undefined") return;
  const real = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    if (url.includes("/api/bff/auth/github/status"))
      return Response.json(SESSION);
    if (url.includes("/api/bff/operate/observability"))
      return Response.json(OBSERVABILITY);
    if (url.includes("/api/bff/operate/transactions"))
      return Response.json(TRANSACTIONS);
    if (url.includes("/api/bff/operate/logs")) return Response.json(LOGS);
    if (url.includes("/api/bff/operate/usage")) return Response.json(USAGE);
    return real(input, init);
  };
}

const KINDS: ViewKind[] = ["observability", "transactions", "usage", "logs"];

export default function DevOperatePreview() {
  const [ready] = useState(() => {
    stubFetch();
    return true;
  });
  const router = useRouter();
  const [kind, setKind] = useState<ViewKind>("usage");
  const [detailApp, setDetailApp] = useState<string | null>(null);
  if (!ready) return null;

  const detail = detailApp ? appFixture(detailApp) : undefined;
  if (detail) {
    return (
      <AppDetailView
        app={detail}
        example
        dashboardHref="https://grafana.example.com/d/app"
        onBack={() => setDetailApp(null)}
        onOpenTrace={(tool) => {
          // Deep link through real URL params — the same links the product uses.
          router.replace(
            `/dev/operate-preview?app=${encodeURIComponent(detail.meta.name)}&tool=${encodeURIComponent(tool)}`,
            { scroll: false },
          );
          setDetailApp(null);
          setKind("logs");
        }}
        onOpenTx={(txId) => {
          router.replace(
            `/dev/operate-preview?app=${encodeURIComponent(detail.meta.name)}&tx=${encodeURIComponent(txId)}`,
            { scroll: false },
          );
          setDetailApp(null);
          setKind("transactions");
        }}
      />
    );
  }

  return (
    <GitHubSessionProvider>
      <div className="border-border mx-auto flex w-full max-w-7xl gap-2 border-b px-4 pt-4 sm:px-6 lg:px-8">
        {KINDS.map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setKind(k)}
            className={`rounded-t-md px-3 py-1.5 text-sm capitalize ${
              k === kind
                ? "bg-surface text-foreground border-border border border-b-0"
                : "text-dim"
            }`}
          >
            {k}
          </button>
        ))}
      </div>
      {/* Harness-only: clicking any app card opens its drill-down mock. */}
      <div
        onClickCapture={(event) => {
          if (kind !== "observability") return;
          const card = (event.target as HTMLElement).closest(
            "div.rounded-md.border",
          );
          const name = APP_NAMES.find((appName) =>
            card?.textContent?.includes(appName),
          );
          if (name) setDetailApp(name);
        }}
      >
        <Suspense fallback={null}>
          <OperateView key={kind} kind={kind} />
        </Suspense>
      </div>
    </GitHubSessionProvider>
  );
}
