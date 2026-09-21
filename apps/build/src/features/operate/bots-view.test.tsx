import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render as rtlRender, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";

import type { GitHubAccountState } from "@build/components/control-plane/github-session-context";

let sessionAccount: GitHubAccountState = {
  loading: true,
  signedIn: false,
  githubLogin: null,
  githubAvatarUrl: null,
  installationId: null,
};

vi.mock("@build/components/control-plane/github-session-context", () => ({
  useGitHubSession: () => ({
    account: sessionAccount,
    setAccount: vi.fn(),
  }),
}));

vi.mock("./client", () => ({
  operateFetch: vi.fn(),
}));

import { operateFetch } from "./client";
import { BotsView } from "./bots-view";

const mockedOperateFetch = vi.mocked(operateFetch);

function render(ui: ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return rtlRender(
    <QueryClientProvider client={client}>{ui}</QueryClientProvider>,
  );
}

function mockSession(partial: {
  loading: boolean;
  signedIn: boolean;
  githubLogin?: string | null;
}) {
  sessionAccount = {
    loading: partial.loading,
    signedIn: partial.signedIn,
    githubLogin: partial.githubLogin ?? null,
    githubAvatarUrl: null,
    installationId: null,
  };
}

const PROJECTS = [
  {
    id: 1,
    repositoryLink: "ceciliaz030/local-8",
    apps: [{ id: 11, name: "playground-example", isActive: true }],
  },
];

const BOT = {
  id: "b1",
  platform: "telegram",
  status: "active",
  label: null,
  defaultApp: "playground-example",
  platformBotId: "8184083135",
  platformUsername: "chico_chico_bot",
  webhookUrl: "https://x",
  threadMode: "single",
  createdAt: 1,
  apps: [
    {
      applicationId: 11,
      projectId: 1,
      projectLabel: "ceciliaz030/local-8",
      name: "playground-example",
      label: "playground-example",
      isPrimary: true,
    },
  ],
};

afterEach(() => {
  mockedOperateFetch.mockReset();
  window.history.replaceState({}, "", "/integrations");
  window.localStorage.clear();
});

describe("BotsView", () => {
  it("shows the sign-in panel when not signed in with GitHub", () => {
    mockSession({ loading: false, signedIn: false });
    render(<BotsView />);
    expect(
      screen.getByRole("link", { name: /continue with github/i }),
    ).toBeInTheDocument();
    expect(mockedOperateFetch).not.toHaveBeenCalled();
  });

  it("renders registered bots as cards with masked tokens", async () => {
    mockSession({ loading: false, signedIn: true, githubLogin: "octocat" });
    mockedOperateFetch.mockResolvedValue({
      projects: PROJECTS,
      bots: [{ ...BOT, label: "Trading assistant" }],
    });
    render(<BotsView />);
    expect(await screen.findByText("Trading assistant")).toBeInTheDocument();
    expect(screen.getByText("@chico_chico_bot")).toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(screen.getByText(/8184083135:•/)).toBeInTheDocument();
    expect(screen.getByText("1 bot")).toBeInTheDocument();
  });

  it("reads and writes the builder-wide app set regardless of shell platform", async () => {
    window.history.replaceState(
      {},
      "",
      "/integrations?platform=world-market-apps",
    );
    mockSession({ loading: false, signedIn: true, githubLogin: "octocat" });
    mockedOperateFetch.mockResolvedValue({ projects: PROJECTS, bots: [BOT] });
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(Response.json({ bot: BOT }));
    render(<BotsView />);

    fireEvent.click(
      await screen.findByRole("button", { name: /change apps/i }),
    );
    fireEvent.click(screen.getByRole("button", { name: /^save/i }));
    await screen.findByRole("button", { name: /change apps/i });

    expect(mockedOperateFetch).toHaveBeenCalledWith("bots");
    const [patchUrl] = fetchSpy.mock.calls.find(
      ([, init]) => init?.method === "PATCH",
    )!;
    expect(String(patchUrl)).not.toContain("platform=");
    fetchSpy.mockRestore();
  });

  it("requires a token and an app before registering", async () => {
    mockSession({ loading: false, signedIn: true, githubLogin: "octocat" });
    mockedOperateFetch.mockResolvedValue({ projects: PROJECTS, bots: [] });
    render(<BotsView />);

    fireEvent.click(await screen.findByRole("button", { name: /add bot/i }));
    const register = screen.getByRole("button", { name: /register bot/i });
    expect(register).toBeDisabled();

    fireEvent.change(screen.getByPlaceholderText(/paste botfather token/i), {
      target: { value: "123:abc" },
    });
    expect(register).toBeDisabled();

    fireEvent.click(
      screen.getByRole("checkbox", { name: /attach playground-example/i }),
    );
    expect(register).toBeEnabled();
  });

  it("edit mode saves thread mode changes through PATCH", async () => {
    mockSession({ loading: false, signedIn: true, githubLogin: "octocat" });
    mockedOperateFetch.mockResolvedValue({ projects: PROJECTS, bots: [BOT] });
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        Response.json({ bot: { ...BOT, threadMode: "multi" } }),
      );
    render(<BotsView />);

    fireEvent.click(
      await screen.findByRole("button", { name: /change apps/i }),
    );
    expect(screen.getByText("Editing")).toBeInTheDocument();
    // Two thread-mode toggles are on screen (explainer + edit panel); the
    // edit panel's is the last in DOM order.
    const multiRadios = screen.getAllByRole("radio", {
      name: /multiple threads/i,
    });
    fireEvent.click(multiRadios[multiRadios.length - 1]);
    fireEvent.click(screen.getByRole("button", { name: /^save/i }));

    await screen.findByRole("button", { name: /change apps/i });
    const [, patchInit] = fetchSpy.mock.calls.find(
      ([, init]) => init?.method === "PATCH",
    )!;
    expect(JSON.parse(String(patchInit?.body))).toMatchObject({
      botId: "b1",
      applicationIds: [11],
      primaryApplicationId: 11,
      threadMode: "multi",
    });
    fetchSpy.mockRestore();
  });

  it("edits the primary app tenant URL and custom commands", async () => {
    mockSession({ loading: false, signedIn: true, githubLogin: "octocat" });
    const configuredBot = {
      ...BOT,
      apps: [
        {
          ...BOT.apps[0],
          tenantBaseUrl: "https://api.world.inc/mini-app",
          commands: ["b", "p"],
        },
      ],
    };
    mockedOperateFetch.mockResolvedValue({
      projects: PROJECTS,
      bots: [configuredBot],
    });
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(Response.json({ bot: configuredBot }));
    render(<BotsView />);

    fireEvent.click(
      await screen.findByRole("button", { name: /change apps/i }),
    );
    fireEvent.change(screen.getByLabelText(/tenant mini app url/i), {
      target: { value: "https://api.world.inc/mini-app-v2" },
    });
    fireEvent.change(screen.getByPlaceholderText("b, p, r, chart"), {
      target: { value: "/B, r chart" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^save/i }));

    await screen.findByRole("button", { name: /change apps/i });
    const [, patchInit] = fetchSpy.mock.calls.find(
      ([, init]) => init?.method === "PATCH",
    )!;
    expect(JSON.parse(String(patchInit?.body))).toMatchObject({
      tenantBaseUrl: "https://api.world.inc/mini-app-v2",
      commands: ["b", "r", "chart"],
    });
    fetchSpy.mockRestore();
  });

  it("cancelling edit restores the draft", async () => {
    mockSession({ loading: false, signedIn: true, githubLogin: "octocat" });
    mockedOperateFetch.mockResolvedValue({ projects: PROJECTS, bots: [BOT] });
    render(<BotsView />);

    fireEvent.click(
      await screen.findByRole("button", { name: /change apps/i }),
    );
    expect(screen.getByText("Editing")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(
      screen.getByRole("button", { name: /change apps/i }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Editing")).not.toBeInTheDocument();
  });

  it("blocks saving while unavailable apps stay selected", async () => {
    mockSession({ loading: false, signedIn: true, githubLogin: "octocat" });
    mockedOperateFetch.mockResolvedValue({
      projects: PROJECTS,
      bots: [
        {
          ...BOT,
          apps: [
            ...BOT.apps,
            {
              applicationId: 99,
              projectId: null,
              projectLabel: "ceciliaz030/retired",
              name: "gone-app",
              label: "gone-app",
              isPrimary: false,
            },
          ],
        },
      ],
    });
    render(<BotsView />);

    fireEvent.click(
      await screen.findByRole("button", { name: /change apps/i }),
    );
    expect(
      screen.getByText(/no longer available/i, { selector: "td" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^save/i })).toBeDisabled();
    expect(
      screen.getByText(/uncheck the apps that are no longer available/i),
    ).toBeInTheDocument();

    const ghostRow = screen.getByRole("checkbox", { name: /detach gone-app/i });
    expect(ghostRow).toBeEnabled();
    fireEvent.click(ghostRow);
    expect(ghostRow).toBeDisabled();
    expect(screen.getByRole("button", { name: /^save/i })).toBeEnabled();
    expect(
      screen.queryByText(/uncheck the apps that are no longer available/i),
    ).not.toBeInTheDocument();
  });
});
