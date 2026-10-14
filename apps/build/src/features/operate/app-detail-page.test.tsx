import { fireEvent, render as rtlRender, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppDetailPage } from "./app-detail-page";

const push = vi.fn();
const operateAppDetailFetch = vi.fn();

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: (await import("@/test-navigation-link")).TestNavigationLink,
  useRouter: () => ({ navigate: ({ href }: { href: string }) => push(href) }),
}));

vi.mock("@/components/control-plane/github-session-context", () => ({
  useGitHubSession: () => ({
    account: {
      loading: false,
      signedIn: true,
      githubLogin: "octocat",
      githubAvatarUrl: null,
      installationId: null,
    },
  }),
}));

vi.mock("./client", () => ({
  operateAppDetailFetch: (...args: unknown[]) => operateAppDetailFetch(...args),
}));

function render(ui: ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return rtlRender(
    <QueryClientProvider client={client}>{ui}</QueryClientProvider>,
  );
}

const payload = {
  detail: {
    project: { id: 1586, repositoryLink: "https://github.com/aomi/demo" },
    platform: "community",
    windowSeconds: 86400,
    app: {
      applicationId: 77,
      name: "goal-digger",
      releaseTag: "apps-1586-goal-digger-abc123",
      sdkVersion: "3.0.3",
      active: true,
      loaded: true,
      status: "healthy",
    },
    funnel: {
      chats24h: 12,
      toolCalls24h: 30,
      txProposed24h: 4,
      txSubmitted24h: 3,
      txConfirmed24h: 2,
      txReverted24h: 1,
    },
    activeUsers24h: 5,
    credits: {
      credits24h: 8.5,
      creditsPerTurn24h: 0.71,
      creditsDaily: [{ day: "2026-07-19", credits: 8.5 }],
    },
    tools: [
      {
        tool: "get_price",
        calls: 20,
        errors: 1,
        errorRate: 0.05,
        p95Ms: 310,
        lastError: null,
      },
    ],
    lifecycle: {
      coldStartMs: 1250,
      dylibBytes: 4718592,
      loads24h: 2,
      evictions24h: 1,
    },
    hourly: {
      chats: [0, 2, 3],
      toolCalls: [1, 4, 5],
      p95LatencyMs: [800, 1_200, 950],
      transactions: [0, 1, 1],
    },
  },
  health: {
    applicationId: 77,
    application: "goal-digger",
    status: "healthy",
    metrics: {
      p95LatencyMs: 1200,
      inflightRequests: 1,
      errorRate: 0.02,
      toolErrorRate: 0.05,
      txErrorRate: 0.1,
    },
  },
  transactions: [
    {
      id: "tx-1",
      externalTxId: "ext-1",
      application: "goal-digger",
      applicationId: 77,
      status: "rejected",
      txHash: "0xabc",
      chainId: 1,
      chainName: "Ethereum",
      family: "evm",
      fromAddress: "0xfrom",
      toAddress: "0xto",
      value: "1",
      description: "Rejected transfer",
      txFee: "0.00021 ETH",
      createdAt: 1_752_966_000,
    },
  ],
  logs: [],
  deployments: [],
};

describe("AppDetailPage", () => {
  beforeEach(() => {
    push.mockReset();
    operateAppDetailFetch.mockReset();
    operateAppDetailFetch.mockResolvedValue(payload);
  });

  it("renders the live detail aggregate under the owned app identity", async () => {
    render(<AppDetailPage applicationId={77} />);

    expect(
      await screen.findByRole("heading", { name: "goal-digger" }),
    ).toBeInTheDocument();
    expect(operateAppDetailFetch).toHaveBeenCalledWith(77);
    expect(screen.queryByText("Partial example data")).not.toBeInTheDocument();
    expect(screen.getByText("Conversion funnel · 24h")).toBeInTheDocument();
    expect(screen.getByText(/20 calls · 1 error/)).toBeInTheDocument();
    // Live rows: rejected renders as a failed chip, ISO time as a short clock.
    expect(screen.getByText("Rejected transfer")).toBeInTheDocument();
    expect(screen.getByText("failed")).toBeInTheDocument();
    expect(screen.getByText(/^\d{2}:\d{2} UTC$/)).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "Back to observability" }),
    );
    expect(push).toHaveBeenCalledWith("/operate/observability?project=1586");
  });

  it("deep-links real tool rows through the operate logs route", async () => {
    render(<AppDetailPage applicationId={77} />);

    fireEvent.click(await screen.findByText("get_price"));
    expect(push).toHaveBeenCalledWith(
      "/operate/logs?app=goal-digger&tool=get_price&project=1586",
    );
  });

  it("derives the parent Project for project-scoped drill-down links", async () => {
    render(<AppDetailPage applicationId={77} />);

    expect(
      await screen.findByRole("heading", { name: "goal-digger" }),
    ).toBeInTheDocument();
    expect(operateAppDetailFetch).toHaveBeenCalledWith(77);

    fireEvent.click(
      screen.getByRole("button", { name: "Back to observability" }),
    );
    expect(push).toHaveBeenCalledWith("/operate/observability?project=1586");
  });
});
