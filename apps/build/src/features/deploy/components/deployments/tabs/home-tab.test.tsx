import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";

const loadSecrets = vi.fn();
const loadRequiredSecrets = vi.fn();
const operateFetch = vi.fn();

vi.mock("@/features/operate/client", () => ({
  operateFetch: (...args: unknown[]) => operateFetch(...args),
}));

vi.mock("@/features/deploy/hooks/use-project-detail", () => ({
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
  typeof import("@/features/deploy/hooks/use-project-detail").useProjectDetail
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
    delete (detail.source as { sdkVersion?: string }).sdkVersion;
    delete (detail.source as { sdkVersions?: string[] }).sdkVersions;
    for (const key of [
      "ffiVersion",
      "ffiVersions",
      "requiredFfiVersion",
      "ffiUnrecorded",
      "ffiIncompatible",
      "ffiUnverifiedSdkVersions",
    ] as const) {
      delete (detail.source as Record<string, unknown>)[key];
    }
    (detail as { requiredSecrets: unknown }).requiredSecrets = null;
    (detail as { sdk: unknown }).sdk = null;
  });

  it.each([
    { loaded: undefined, label: "Activated" },
    { loaded: false, label: "Activated — runtime not verified" },
    { loaded: true, label: "Live" },
  ])(
    "uses runtime readiness for the Home and Chat cards ($loaded)",
    async ({ loaded, label }) => {
      detail.source!.apps = [
        {
          id: 17,
          name: "my-bot",
          isActive: true,
          appReleaseTag: "release-2",
          loaded,
        },
      ];

      renderTab(<HomeTab detail={detail} />);

      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
      expect(
        screen.getByText(loaded === true ? "Ready" : "Needs live app"),
      ).toBeInTheDocument();
      expect(await screen.findByText("No traffic yet")).toBeInTheDocument();
    },
  );

  it("never shows a clean Live/Ready when the live SDK is outdated", async () => {
    detail.source!.apps = [
      {
        id: 17,
        name: "my-bot",
        isActive: true,
        appReleaseTag: "release-2",
        loaded: true,
      },
    ];
    (detail.source as { sdkVersion?: string }).sdkVersion = "5.0.0";
    (detail as { sdk: unknown }).sdk = {
      sdkStatus: { requiredVersion: "5.1.0" },
    };

    renderTab(
      <HomeTab detail={detail} tabHref={(tab) => `/projects/1?tab=${tab}`} />,
    );

    const callout = screen.getByTestId("sdk-callout");
    expect(callout).toHaveTextContent(
      "Active application built with SDK 5.0.0 — backend requires 5.1.0; redeploy to update.",
    );
    expect(screen.getByTestId("sdk-badge")).toHaveTextContent("5.0.0");
    expect(screen.getByText("Outdated")).toBeInTheDocument();
    expect(screen.getByText("Blocked")).toBeInTheDocument();
    expect(screen.queryByText("Ready")).not.toBeInTheDocument();
    expect(
      screen.getAllByRole("link", { name: "Upgrade to 5.1.0" })[0],
    ).toHaveAttribute("href", "/projects/1?tab=deployments");
    expect(await screen.findByText("No traffic yet")).toBeInTheDocument();
  });

  // Compatible, SDK drift: amber warning and upgrade, but the runtime loads
  // the release, so chat is Ready and nothing says it is gated.
  it("warns about SDK drift on a supported FFI without blocking chat", async () => {
    detail.source!.apps = [
      {
        id: 17,
        name: "my-bot",
        isActive: true,
        appReleaseTag: "release-2",
        loaded: true,
      },
    ];
    Object.assign(detail.source!, {
      sdkVersion: "5.1.1",
      sdkVersions: ["5.1.1"],
      ffiVersion: 1,
      ffiVersions: [1],
      requiredFfiVersion: 1,
      ffiUnrecorded: false,
    });
    (detail as { sdk: unknown }).sdk = {
      sdkStatus: { requiredVersion: "6.0.0" },
    };

    renderTab(
      <HomeTab detail={detail} tabHref={(tab) => `/projects/1?tab=${tab}`} />,
    );

    const callout = screen.getByTestId("sdk-callout");
    expect(callout).toHaveAttribute("data-severity", "warning");
    expect(callout).toHaveTextContent(
      "Active application built with SDK 5.1.1 — backend requires 6.0.0; redeploy to update.",
    );
    expect(screen.getByTestId("sdk-badge")).toHaveAttribute(
      "data-state",
      "outdated",
    );
    expect(screen.getByText("Outdated")).toBeInTheDocument();
    expect(screen.getByText("Ready")).toBeInTheDocument();
    expect(screen.queryByText("Blocked")).not.toBeInTheDocument();
    expect(screen.queryByText(/before opening chat/)).not.toBeInTheDocument();
    expect(
      screen.getByText(
        "Redeploy with the current SDK to stay up to date. Chat keeps working meanwhile.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getAllByRole("link", { name: "Upgrade to 6.0.0" })[0],
    ).toHaveAttribute("href", "/projects/1?tab=deployments");
    expect(screen.getByRole("link", { name: "Chat tab" })).toHaveAttribute(
      "href",
      "/projects/1?tab=chat",
    );
    expect(await screen.findByText("No traffic yet")).toBeInTheDocument();
  });

  // Fundamental interface mismatch: red, chat blocked, and the copy says
  // rebuild with a supported SDK rather than "match 6.0.0".
  it("offers rebuild guidance without server SDK metadata", async () => {
    Object.assign(detail.source!, {
      sdkVersion: "4.0.0",
      ffiIncompatible: true,
      requiredFfiVersion: 1,
      ffiUnverifiedSdkVersions: ["4.0.0"],
    });
    renderTab(
      <HomeTab detail={detail} tabHref={(tab) => `/projects/1?tab=${tab}`} />,
    );
    expect(
      screen.getByRole("link", { name: "Rebuild and redeploy" }),
    ).toHaveAttribute("href", "/projects/1?tab=deployments");
    expect(
      screen.queryByText("Publish a deployment, then set keys and open chat."),
    ).not.toBeInTheDocument();
    expect(await screen.findByText("No traffic yet")).toBeInTheDocument();
  });

  it("shows a red, chat-blocking verdict for a release the runtime cannot load", async () => {
    detail.source!.apps = [
      {
        id: 17,
        name: "my-bot",
        isActive: true,
        appReleaseTag: "release-2",
        loaded: true,
      },
    ];
    Object.assign(detail.source!, {
      sdkVersion: "4.0.0",
      sdkVersions: ["4.0.0"],
      ffiVersion: null,
      ffiVersions: [],
      requiredFfiVersion: 1,
      ffiUnrecorded: true,
      ffiIncompatible: true,
      ffiUnverifiedSdkVersions: ["4.0.0"],
    });
    (detail as { sdk: unknown }).sdk = {
      sdkStatus: { requiredVersion: "6.0.0" },
    };

    renderTab(
      <HomeTab detail={detail} tabHref={(tab) => `/projects/1?tab=${tab}`} />,
    );

    const callout = screen.getByTestId("sdk-callout");
    expect(callout).toHaveAttribute("data-severity", "error");
    expect(callout).toHaveTextContent(
      "Active application built with SDK 4.0.0 cannot run on this backend (SDK 4.0.0 has no verified FFI contract); rebuild with a supported SDK (5.1.1 or newer) and redeploy.",
    );
    expect(screen.getByTestId("sdk-badge")).toHaveAttribute(
      "data-state",
      "incompatible",
    );
    expect(screen.getByText("Incompatible")).toBeInTheDocument();
    expect(screen.queryByText("Outdated")).not.toBeInTheDocument();
    expect(screen.getByText("Blocked")).toBeInTheDocument();
    expect(screen.queryByText("Ready")).not.toBeInTheDocument();
    expect(
      screen.getByText(
        "Chat is blocked: this app cannot run on the backend. Rebuild it with a supported SDK (5.1.1 or newer) and redeploy.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "This app cannot run on the backend. Rebuild with a supported SDK (5.1.1 or newer) and redeploy before opening chat.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/rebuilt with aomi-sdk 6\.0\.0/),
    ).not.toBeInTheDocument();
    expect(
      screen.getAllByRole("link", { name: "Upgrade to 6.0.0" })[0],
    ).toHaveAttribute("href", "/projects/1?tab=deployments");
    expect(await screen.findByText("No traffic yet")).toBeInTheDocument();
  });

  it("blocks Ready when an incomplete live summary contains an outdated SDK", async () => {
    detail.source!.apps = [
      {
        id: 17,
        name: "my-bot",
        isActive: true,
        appReleaseTag: "release-2",
        loaded: true,
      },
    ];
    detail.source!.sdkVersion = null;
    detail.source!.sdkVersions = ["5.0.0"];
    (detail as { sdk: unknown }).sdk = {
      sdkStatus: { requiredVersion: "5.1.0" },
    };

    renderTab(<HomeTab detail={detail} />);

    expect(screen.getByText("Outdated")).toBeInTheDocument();
    expect(screen.getByText("Blocked")).toBeInTheDocument();
    expect(screen.queryByText("Ready")).not.toBeInTheDocument();
    expect(screen.getByTestId("sdk-callout")).toHaveTextContent(
      "some runtime SDK records are missing",
    );
    expect(await screen.findByText("No traffic yet")).toBeInTheDocument();
  });

  it("qualifies Live when the runtime SDK was never recorded", async () => {
    detail.source!.apps = [
      {
        id: 17,
        name: "my-bot",
        isActive: true,
        appReleaseTag: "release-2",
        loaded: true,
      },
    ];
    (detail as { sdk: unknown }).sdk = {
      sdkStatus: { requiredVersion: "5.1.0" },
    };

    renderTab(<HomeTab detail={detail} />);

    expect(screen.getAllByText("Live").length).toBeGreaterThan(0);
    expect(screen.getByTestId("sdk-callout")).toHaveTextContent(
      "Runtime SDK unrecorded for the active application — backend requires 5.1.0.",
    );
    expect(screen.getByTestId("sdk-badge")).toHaveTextContent(
      "Runtime SDK unrecorded",
    );
    expect(await screen.findByText("No traffic yet")).toBeInTheDocument();
  });

  it("shows a clean Live/Ready only for a recorded, current SDK", async () => {
    detail.source!.apps = [
      {
        id: 17,
        name: "my-bot",
        isActive: true,
        appReleaseTag: "release-2",
        loaded: true,
      },
    ];
    (detail.source as { sdkVersion?: string }).sdkVersion = "5.1.0";
    (detail as { sdk: unknown }).sdk = {
      sdkStatus: { requiredVersion: "5.1.0" },
    };

    renderTab(<HomeTab detail={detail} />);

    expect(screen.queryByTestId("sdk-callout")).not.toBeInTheDocument();
    expect(screen.getByText("Ready")).toBeInTheDocument();
    expect(
      screen.getByText("my-bot is active on aomi-sdk 5.1.0."),
    ).toBeInTheDocument();
    expect(await screen.findByText("No traffic yet")).toBeInTheDocument();
  });

  it("shows status cards and a deploy next action when not live", async () => {
    renderTab(
      <HomeTab detail={detail} tabHref={(tab) => `/projects/1?tab=${tab}`} />,
    );

    expect(loadSecrets).not.toHaveBeenCalled();
    expect(loadRequiredSecrets).toHaveBeenCalledWith();
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
