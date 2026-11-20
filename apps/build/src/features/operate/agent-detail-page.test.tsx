import { fireEvent, render as rtlRender, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AgentDetailPage } from "./agent-detail-page";

const push = vi.fn();
const operateAgentDetailFetch = vi.fn();

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: (await import("@/test/navigation-link")).TestNavigationLink,
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
  operateAgentDetailFetch: (...args: unknown[]) =>
    operateAgentDetailFetch(...args),
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
    agent: {
      agentId: 77,
      name: "goal-digger",
      slug: "aomi/goal-digger",
      releaseTag: "agents-1586-goal-digger-abc123",
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
    agentId: 77,
    agent: "goal-digger",
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
      agent: "goal-digger",
      agentId: 77,
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
};

describe("AgentDetailPage", () => {
  beforeEach(() => {
    push.mockReset();
    operateAgentDetailFetch.mockReset();
    operateAgentDetailFetch.mockResolvedValue(payload);
  });

  it("fetches and caches each selected activity window separately", async () => {
    operateAgentDetailFetch.mockImplementation(async (_id, window) => ({
      ...payload,
      detail: {
        ...payload.detail,
        windowSeconds: window === "7d" ? 604800 : 86400,
        funnel: {
          ...payload.detail.funnel,
          chats24h: window === "7d" ? 42 : 12,
        },
      },
    }));
    render(<AgentDetailPage agentId={77} />);
    await screen.findByRole("heading", { name: "goal-digger" });
    fireEvent.click(screen.getByRole("button", { name: "7d" }));
    expect(
      await screen.findByText("Conversion funnel · 7d"),
    ).toBeInTheDocument();
    expect(operateAgentDetailFetch).toHaveBeenCalledWith(77, "7d");
    expect(screen.getByText("42")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "24h" }));
    expect(
      await screen.findByText("Conversion funnel · 24h"),
    ).toBeInTheDocument();
    expect(screen.queryByText("42")).not.toBeInTheDocument();
    expect(operateAgentDetailFetch).toHaveBeenCalledTimes(2);
  });

  it("renders the live detail aggregate under the owned agent identity", async () => {
    render(<AgentDetailPage agentId={77} />);

    expect(
      await screen.findByRole("heading", { name: "goal-digger" }),
    ).toBeInTheDocument();
    expect(operateAgentDetailFetch).toHaveBeenCalledWith(77, "24h");
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
    render(<AgentDetailPage agentId={77} />);

    fireEvent.click(await screen.findByText("get_price"));
    expect(push).toHaveBeenCalledWith(
      "/operate/logs?agent=goal-digger&tool=get_price&project=1586",
    );
  });

  it("derives the parent Project for project-scoped drill-down links", async () => {
    render(<AgentDetailPage agentId={77} />);

    expect(
      await screen.findByRole("heading", { name: "goal-digger" }),
    ).toBeInTheDocument();
    expect(operateAgentDetailFetch).toHaveBeenCalledWith(77, "24h");

    fireEvent.click(
      screen.getByRole("button", { name: "Back to observability" }),
    );
    expect(push).toHaveBeenCalledWith("/operate/observability?project=1586");
  });

  it("shows a project-less agent and drills down without a project", async () => {
    operateAgentDetailFetch.mockResolvedValue({
      ...payload,
      detail: { ...payload.detail, project: null, platform: null },
    });
    render(<AgentDetailPage agentId={77} />);

    expect(
      await screen.findByRole("heading", { name: "goal-digger" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Rejected transfer")).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Back to observability" }),
    );
    expect(push).toHaveBeenCalledWith("/operate/observability");
    fireEvent.click(screen.getByText("get_price"));
    expect(push).toHaveBeenCalledWith(
      "/operate/logs?agent=goal-digger&tool=get_price",
    );
  });
});
