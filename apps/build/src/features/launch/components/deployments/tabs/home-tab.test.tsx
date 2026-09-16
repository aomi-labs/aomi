import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";

const loadSecrets = vi.fn();
const loadRequiredSecrets = vi.fn();
const operateFetch = vi.fn();

vi.mock("@aomi-labs/deploy/lifecycle", () => ({
  deploymentLifecycleFromProject: () => ({
    kind: "empty",
    repo: "a/b",
    statusLabel: "No deployment",
    statusTone: "muted",
    message: "No deployment recorded yet.",
    appNames: [],
    releaseTags: [],
  }),
}));

vi.mock("@build/features/operate/client", () => ({
  operateFetch: (...args: unknown[]) => operateFetch(...args),
}));

vi.mock("@build/features/launch/hooks/use-project-detail", () => ({
  useProjectDetail: () => detail,
}));

const detail = {
  source: {
    id: 1,
    repositoryLink: "a/b",
    apps: [],
    latestDeployment: null,
    installationId: 5,
  },
  loading: false,
  error: null,
  secretsByApp: {},
  secretsError: null,
  requiredSecrets: null,
  requiredSecretsError: null,
  loadSecrets,
  loadRequiredSecrets,
} as unknown as ReturnType<
  typeof import("@build/features/launch/hooks/use-project-detail").useProjectDetail
>;

import { HomeTab } from "./home-tab";

// Fresh client per render so cached usage reads never leak across tests.
function renderTab(ui: ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>{ui}</QueryClientProvider>,
  );
}

describe("HomeTab", () => {
  beforeEach(() => {
    loadSecrets.mockClear();
    loadRequiredSecrets.mockClear();
    operateFetch.mockReset();
    operateFetch.mockResolvedValue({ daily: [] });
    (detail.source as { apps: unknown[] }).apps = [];
    (detail as { requiredSecrets: unknown }).requiredSecrets = null;
  });

  it("shows status cards and a deploy next action when not live", async () => {
    renderTab(
      <HomeTab detail={detail} tabHref={(tab) => `/projects/1?tab=${tab}`} />,
    );

    expect(loadSecrets).not.toHaveBeenCalled();
    expect(loadRequiredSecrets).toHaveBeenCalled();
    expect(screen.getByText("Project home")).toBeInTheDocument();
    expect(screen.getByText("Not live")).toBeInTheDocument();
    expect(screen.getByText("No apps yet")).toBeInTheDocument();
    expect(screen.queryByText("Keys missing")).not.toBeInTheDocument();
    expect(
      await screen.findByRole("link", {
        name: /redeploy from linked repository/i,
      }),
    ).toHaveAttribute("href", "/projects/1?tab=deployments");
    expect(
      screen.getByRole("link", { name: /open environment/i }),
    ).toHaveAttribute("href", "/projects/1?tab=environment");
    expect(await screen.findByText("No traffic yet")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /^open usage$/i })).toHaveAttribute(
      "href",
      "/operate/usage?project=1",
    );
    expect(screen.queryByText("Monetization")).not.toBeInTheDocument();
  });

  it("warns with the app and key names when a required key is unset", async () => {
    (detail.source as { apps: unknown[] }).apps = [
      { id: 17, name: "somm-agent" },
    ];
    (detail as { requiredSecrets: unknown }).requiredSecrets = {
      "somm-agent": {
        applicationId: 17,
        slots: [{ name: "OPENAI_API_KEY" }],
        missing: ["OPENAI_API_KEY"],
      },
    };

    renderTab(
      <HomeTab detail={detail} tabHref={(tab) => `/projects/1?tab=${tab}`} />,
    );

    expect(screen.getByText("Keys missing")).toBeInTheDocument();
    expect(
      screen.getByText(/1 required key not set for somm-agent: OPENAI_API_KEY/),
    ).toBeInTheDocument();
    expect(await screen.findByText("No traffic yet")).toBeInTheDocument();
  });

  it("shows credits and tokens when usage has traffic", async () => {
    operateFetch.mockResolvedValue({
      daily: [
        {
          periodUtcDay: "2026-07-12",
          creditsUsed: 1.5,
          inputTokens: 1000,
          outputTokens: 250,
        },
      ],
    });
    renderTab(
      <HomeTab detail={detail} tabHref={(tab) => `/projects/1?tab=${tab}`} />,
    );
    expect(await screen.findByText("1.50 credits")).toBeInTheDocument();
    expect(screen.getByText(/1\.3k tokens/i)).toBeInTheDocument();
  });

  it("shows configured monetization before the first paid call", async () => {
    (detail.source as { apps: unknown[] }).apps = [
      {
        name: "somm-agent",
        pricing: {
          config: {
            resources: {
              get_idle_assets: {
                pricing: { flat: 100 },
                beneficiary: "banana_evm",
              },
            },
            beneficiaries: [
              {
                name: "banana_evm",
                chain: "eip155:84532",
                value: "0x5D907BEa404e6F821d467314a9cA07663CF64c9B",
              },
            ],
          },
        },
      },
    ];

    renderTab(
      <HomeTab detail={detail} tabHref={(tab) => `/projects/1?tab=${tab}`} />,
    );

    expect(screen.getByText("Monetization")).toBeInTheDocument();
    expect(screen.getByText("1 priced tool")).toBeInTheDocument();
    expect(
      screen.getByText(/100\.00 credits \(\$1\.00\) per successful call/),
    ).toBeInTheDocument();
    expect(screen.getByText(/Base Sepolia/)).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "View partner ledger" }),
    ).toHaveAttribute("href", "/operate/usage?project=1#partner-payments");
    expect(await screen.findByText("No traffic yet")).toBeInTheDocument();
  });

  it("uses canonical Project identity for usage and ledger reads", async () => {
    (detail.source as { apps: unknown[] }).apps = [
      {
        name: "somm-agent",
        pricing: {
          config: {
            resources: {
              get_idle_assets: {
                pricing: { flat: 100 },
                beneficiary: "banana_evm",
              },
            },
            beneficiaries: [],
          },
        },
      },
    ];

    renderTab(
      <HomeTab detail={detail} tabHref={(tab) => `/projects/1?tab=${tab}`} />,
    );

    expect(await screen.findByText("No traffic yet")).toBeInTheDocument();
    expect(operateFetch).toHaveBeenCalledWith("usage", {
      projectId: 1,
    });
    expect(screen.getByRole("link", { name: /^open usage$/i })).toHaveAttribute(
      "href",
      "/operate/usage?project=1",
    );
    expect(
      screen.getByRole("link", { name: "View partner ledger" }),
    ).toHaveAttribute("href", "/operate/usage?project=1#partner-payments");
  });
});
