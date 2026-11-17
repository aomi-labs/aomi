import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render as rtlRender, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";

import type { GitHubAccountState } from "@/components/control-plane/github-session-context";

let sessionAccount: GitHubAccountState = {
  loading: true,
  signedIn: false,
  githubLogin: null,
  githubAvatarUrl: null,
  installationId: null,
};

vi.mock("@/components/control-plane/github-session-context", () => ({
  useGitHubSession: () => ({
    account: sessionAccount,
    setAccount: vi.fn(),
  }),
}));

vi.mock("./client", () => ({
  operateFetch: vi.fn(),
}));

import { operateFetch } from "./client";
import { ChannelsView } from "./channels-view";

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
    agents: [{ id: 11, name: "playground-example", isActive: true }],
  },
];

const CHANNEL = {
  id: "b1",
  kind: "telegram",
  status: "active",
  label: null,
  agentId: 11,
  miniAppUrl: null,
  commandEndpoint: null,
  commands: [],
  externalBotId: "8184083135",
  platformUsername: "chico_chico_bot",
  webhookUrl: "https://x",
  threadMode: "single",
  configurationVersion: 1,
  createdAt: 1,
  agent: {
    id: 11,
    projectId: 1,
    projectLabel: "ceciliaz030/local-8",
    name: "playground-example",
    displayName: "playground-example",
  },
};

afterEach(() => {
  mockedOperateFetch.mockReset();
  window.history.replaceState({}, "", "/integrations");
  window.localStorage.clear();
});

describe("ChannelsView", () => {
  it("shows the sign-in panel when not signed in with GitHub", () => {
    mockSession({ loading: false, signedIn: false });
    render(<ChannelsView />);
    expect(
      screen.getByRole("link", { name: /continue with github/i }),
    ).toBeInTheDocument();
    expect(mockedOperateFetch).not.toHaveBeenCalled();
  });

  it("renders registered channels as cards with masked tokens", async () => {
    mockSession({ loading: false, signedIn: true, githubLogin: "octocat" });
    mockedOperateFetch.mockResolvedValue({
      projects: PROJECTS,
      channels: [{ ...CHANNEL, label: "Trading assistant" }],
    });
    render(<ChannelsView />);
    expect(await screen.findByText("Trading assistant")).toBeInTheDocument();
    expect(screen.getByText("@chico_chico_bot")).toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(screen.getByText(/8184083135:•/)).toBeInTheDocument();
    expect(screen.getByText("1 channel")).toBeInTheDocument();
  });

  it("reads and writes the builder-wide agent set regardless of shell platform", async () => {
    window.history.replaceState(
      {},
      "",
      "/integrations?platform=world-market-agents",
    );
    mockSession({ loading: false, signedIn: true, githubLogin: "octocat" });
    mockedOperateFetch.mockResolvedValue({
      projects: PROJECTS,
      channels: [CHANNEL],
    });
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(Response.json({ channel: CHANNEL }));
    render(<ChannelsView />);

    fireEvent.click(
      await screen.findByRole("button", { name: /change agents/i }),
    );
    fireEvent.click(screen.getByRole("button", { name: /^save/i }));
    await screen.findByRole("button", { name: /change agents/i });

    expect(mockedOperateFetch).toHaveBeenCalledWith("channels");
    const [patchUrl] = fetchSpy.mock.calls.find(
      ([, init]) => init?.method === "PATCH",
    )!;
    expect(String(patchUrl)).not.toContain("platform=");
    fetchSpy.mockRestore();
  });

  it("requires a token and an agent before registering", async () => {
    mockSession({ loading: false, signedIn: true, githubLogin: "octocat" });
    mockedOperateFetch.mockResolvedValue({ projects: PROJECTS, channels: [] });
    render(<ChannelsView />);

    fireEvent.click(
      await screen.findByRole("button", { name: /add channel/i }),
    );
    const register = screen.getByRole("button", { name: /register channel/i });
    expect(register).toBeDisabled();

    fireEvent.change(screen.getByPlaceholderText(/paste botfather token/i), {
      target: { value: "123:abc" },
    });
    expect(register).toBeDisabled();

    fireEvent.click(
      screen.getByRole("radio", { name: /select playground-example/i }),
    );
    expect(register).toBeEnabled();
  });

  it("edit mode saves thread mode changes through PATCH", async () => {
    mockSession({ loading: false, signedIn: true, githubLogin: "octocat" });
    mockedOperateFetch.mockResolvedValue({
      projects: PROJECTS,
      channels: [CHANNEL],
    });
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        Response.json({ channel: { ...CHANNEL, threadMode: "multi" } }),
      );
    render(<ChannelsView />);

    fireEvent.click(
      await screen.findByRole("button", { name: /change agents/i }),
    );
    expect(screen.getByText("Editing")).toBeInTheDocument();
    // Two thread-mode toggles are on screen (explainer + edit panel); the
    // edit panel's is the last in DOM order.
    const multiRadios = screen.getAllByRole("radio", {
      name: /multiple threads/i,
    });
    fireEvent.click(multiRadios[multiRadios.length - 1]);
    fireEvent.click(screen.getByRole("button", { name: /^save/i }));

    await screen.findByRole("button", { name: /change agents/i });
    const [, patchInit] = fetchSpy.mock.calls.find(
      ([, init]) => init?.method === "PATCH",
    )!;
    expect(JSON.parse(String(patchInit?.body))).toMatchObject({
      channelId: "b1",
      agentId: 11,
      threadMode: "multi",
    });
    fetchSpy.mockRestore();
  });

  it("selects the channel’s agent", async () => {
    mockSession({ loading: false, signedIn: true, githubLogin: "octocat" });
    mockedOperateFetch.mockResolvedValue({
      projects: PROJECTS,
      channels: [CHANNEL],
    });
    render(<ChannelsView />);
    fireEvent.click(
      await screen.findByRole("button", { name: /change agents/i }),
    );
    expect(
      screen.getByRole("radio", {
        name: /select playground-example /i,
      }),
    ).toBeChecked();
  });

  it("an untouched save omits the channel command fields", async () => {
    mockSession({ loading: false, signedIn: true, githubLogin: "octocat" });
    const configured = {
      ...CHANNEL,
      miniAppUrl: "https://world.example/mini",
      commandEndpoint: "https://api.world.inc/commands",
      commands: ["b", "p"],
    };
    mockedOperateFetch.mockResolvedValue({
      projects: PROJECTS,
      channels: [configured],
    });
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(Response.json({ channel: configured }));
    render(<ChannelsView />);

    fireEvent.click(
      await screen.findByRole("button", { name: /change agents/i }),
    );
    // Fields are seeded from the channel, not from an agent.
    expect(screen.getByLabelText(/mini app url/i)).toHaveValue(
      "https://world.example/mini",
    );
    expect(screen.getByLabelText(/command endpoint/i)).toHaveValue(
      "https://api.world.inc/commands",
    );
    expect(screen.getByLabelText(/custom commands/i)).toHaveValue("b, p");
    fireEvent.click(screen.getByRole("button", { name: /^save/i }));

    await screen.findByRole("button", { name: /change agents/i });
    const [, patchInit] = fetchSpy.mock.calls.find(
      ([, init]) => init?.method === "PATCH",
    )!;
    const body = JSON.parse(String(patchInit?.body));
    expect(body).toEqual({
      channelId: "b1",
      agentId: 11,
      threadMode: "single",
    });
    fetchSpy.mockRestore();
  });

  it("re-seeds the card when the server's channel changes, so a stale draft is never sent back", async () => {
    mockSession({ loading: false, signedIn: true, githubLogin: "octocat" });
    mockedOperateFetch.mockResolvedValue({
      projects: PROJECTS,
      channels: [CHANNEL],
    });
    // The save response is what the server now holds: another admin (or the
    // backend) set a command endpoint and commands and bumped the version.
    const refreshed = {
      ...CHANNEL,
      configurationVersion: 2,
      commandEndpoint: "https://api.world.inc/commands",
      commands: ["b"],
    };
    // A fresh Response per call: a body can only be read once.
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(() =>
        Promise.resolve(Response.json({ channel: refreshed })),
      );
    render(<ChannelsView />);

    fireEvent.click(
      await screen.findByRole("button", { name: /change agents/i }),
    );
    expect(screen.getByLabelText(/command endpoint/i)).toHaveValue("");
    fireEvent.click(screen.getByRole("button", { name: /^save/i }));
    await screen.findByRole("button", { name: /change agents/i });

    // Reopening edits the refreshed channel, not the draft from before the save.
    fireEvent.click(screen.getByRole("button", { name: /change agents/i }));
    expect(screen.getByLabelText(/command endpoint/i)).toHaveValue(
      "https://api.world.inc/commands",
    );
    expect(screen.getByLabelText(/custom commands/i)).toHaveValue("b");
    fireEvent.click(screen.getByRole("button", { name: /^save/i }));
    await screen.findByRole("button", { name: /change agents/i });

    const patches = fetchSpy.mock.calls
      .filter(([, init]) => init?.method === "PATCH")
      .map(([, init]) => JSON.parse(String(init?.body)));
    expect(patches).toHaveLength(2);
    // Neither save carried command fields: the first draft matched its seed,
    // and the second was re-seeded from the refreshed channel.
    for (const body of patches) {
      expect(body).not.toHaveProperty("commandEndpoint");
      expect(body).not.toHaveProperty("commands");
      expect(body).not.toHaveProperty("miniAppUrl");
      expect(body).not.toHaveProperty("miniAppLabel");
    }
    fetchSpy.mockRestore();
  });

  it("sends only the edited command fields, clearing a URL as null", async () => {
    mockSession({ loading: false, signedIn: true, githubLogin: "octocat" });
    const configured = {
      ...CHANNEL,
      miniAppUrl: "https://world.example/mini",
      commandEndpoint: "https://api.world.inc/commands",
      commands: ["b", "p"],
    };
    mockedOperateFetch.mockResolvedValue({
      projects: PROJECTS,
      channels: [configured],
    });
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(Response.json({ channel: configured }));
    render(<ChannelsView />);

    fireEvent.click(
      await screen.findByRole("button", { name: /change agents/i }),
    );
    fireEvent.change(screen.getByLabelText(/mini app url/i), {
      target: { value: "  " },
    });
    fireEvent.change(screen.getByLabelText(/menu button label/i), {
      target: { value: " Portfolio " },
    });
    fireEvent.change(screen.getByLabelText(/custom commands/i), {
      target: { value: "/B, r chart" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^save/i }));

    await screen.findByRole("button", { name: /change agents/i });
    const [, patchInit] = fetchSpy.mock.calls.find(
      ([, init]) => init?.method === "PATCH",
    )!;
    const body = JSON.parse(String(patchInit?.body));
    expect(body).toMatchObject({
      miniAppUrl: null,
      miniAppLabel: "Portfolio",
      commands: ["b", "r", "chart"],
    });
    expect(body).not.toHaveProperty("commandEndpoint");
    fetchSpy.mockRestore();
  });

  it("disables save when commands are set without an endpoint", async () => {
    mockSession({ loading: false, signedIn: true, githubLogin: "octocat" });
    mockedOperateFetch.mockResolvedValue({
      projects: PROJECTS,
      channels: [CHANNEL],
    });
    render(<ChannelsView />);

    fireEvent.click(
      await screen.findByRole("button", { name: /change agents/i }),
    );
    fireEvent.change(screen.getByLabelText(/custom commands/i), {
      target: { value: "b" },
    });
    expect(screen.getByRole("button", { name: /^save/i })).toBeDisabled();
    expect(
      screen.getByText(/custom commands need a command endpoint/i),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/command endpoint/i), {
      target: { value: "https://api.world.inc/commands" },
    });
    expect(screen.getByRole("button", { name: /^save/i })).toBeEnabled();
  });

  it("reveals the command secret through the Build server route", async () => {
    mockSession({ loading: false, signedIn: true, githubLogin: "octocat" });
    mockedOperateFetch.mockResolvedValue({
      projects: PROJECTS,
      channels: [CHANNEL],
    });
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(Response.json({ commandSecret: "deadbeef" }));
    render(<ChannelsView />);

    fireEvent.click(
      await screen.findByRole("button", { name: /change agents/i }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: /reveal command secret/i }),
    );
    const field = await screen.findByLabelText(/command secret/i);
    expect(field).toHaveValue("deadbeef");
    expect(field).toHaveAttribute("readonly");
    expect(String(fetchSpy.mock.calls[0][0])).toBe(
      "/api/build/operate/channels/b1/command-secret",
    );
    fetchSpy.mockRestore();
  });

  it("checks the webhook through the Build server route and reports a repair", async () => {
    mockSession({ loading: false, signedIn: true, githubLogin: "octocat" });
    mockedOperateFetch.mockResolvedValue({
      projects: PROJECTS,
      channels: [CHANNEL],
    });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({
        webhook: {
          urlMatches: false,
          pendingUpdateCount: 3,
          lastErrorMessage: "Wrong response from the webhook: 404 Not Found",
          reasserted: true,
          warning: null,
        },
      }),
    );
    render(<ChannelsView />);

    fireEvent.click(
      await screen.findByRole("button", { name: /check webhook/i }),
    );
    const status = await screen.findByTestId("channel-webhook-status");
    expect(status).toHaveTextContent(
      "Webhook was not pointed at Aomi; re-pointed now · 3 pending updates · last Telegram error: Wrong response from the webhook: 404 Not Found",
    );
    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toBe("/api/build/operate/channels/b1/webhook");
    expect(init?.method).toBe("POST");
    fetchSpy.mockRestore();
  });

  it("shows a failed webhook check without a status line", async () => {
    mockSession({ loading: false, signedIn: true, githubLogin: "octocat" });
    mockedOperateFetch.mockResolvedValue({
      projects: PROJECTS,
      channels: [CHANNEL],
    });
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        Response.json(
          { error: "Telegram did not answer the webhook query" },
          { status: 502 },
        ),
      );
    render(<ChannelsView />);

    fireEvent.click(
      await screen.findByRole("button", { name: /check webhook/i }),
    );
    expect(
      await screen.findByText("Telegram did not answer the webhook query"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("channel-webhook-status")).toBeNull();
    fetchSpy.mockRestore();
  });

  it("keeps a saved channel and shows the manager's webhook warning", async () => {
    mockSession({ loading: false, signedIn: true, githubLogin: "octocat" });
    mockedOperateFetch.mockResolvedValue({
      projects: PROJECTS,
      channels: [CHANNEL],
    });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({
        channel: { ...CHANNEL, configurationVersion: 2 },
        webhookWarning: "Telegram setWebhook failed (502 Bad Gateway)",
      }),
    );
    render(<ChannelsView />);

    fireEvent.click(
      await screen.findByRole("button", { name: /change agents/i }),
    );
    fireEvent.click(screen.getByRole("button", { name: /^save/i }));
    await screen.findByRole("button", { name: /change agents/i });

    expect(
      screen.getByText(
        /saved, but the webhook was not re-asserted: telegram setwebhook failed \(502 bad gateway\)/i,
      ),
    ).toBeInTheDocument();
    fetchSpy.mockRestore();
  });

  it("keeps the save warning through a failed check and drops it after a good one", async () => {
    mockSession({ loading: false, signedIn: true, githubLogin: "octocat" });
    mockedOperateFetch.mockResolvedValue({
      projects: PROJECTS,
      channels: [CHANNEL],
    });
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        Response.json({
          channel: { ...CHANNEL, configurationVersion: 2 },
          webhookWarning: "Telegram setWebhook failed (502 Bad Gateway)",
        }),
      )
      .mockResolvedValueOnce(
        Response.json({ error: "Telegram did not answer" }, { status: 502 }),
      )
      .mockResolvedValueOnce(
        Response.json({
          webhook: {
            urlMatches: true,
            pendingUpdateCount: 0,
            lastErrorMessage: null,
            reasserted: false,
            warning: null,
          },
        }),
      );
    render(<ChannelsView />);

    fireEvent.click(
      await screen.findByRole("button", { name: /change agents/i }),
    );
    fireEvent.click(screen.getByRole("button", { name: /^save/i }));
    await screen.findByRole("button", { name: /change agents/i });
    const warning = () =>
      screen.queryByText(/saved, but the webhook was not re-asserted/i);
    expect(warning()).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /check webhook/i }));
    expect(
      await screen.findByText("Telegram did not answer"),
    ).toBeInTheDocument();
    expect(warning()).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /check webhook/i }));
    expect(
      await screen.findByTestId("channel-webhook-status"),
    ).toHaveTextContent("Webhook OK · 0 pending updates");
    expect(warning()).toBeNull();
    expect(screen.queryByText("Telegram did not answer")).toBeNull();
    fetchSpy.mockRestore();
  });

  it("read mode shows the effective Mini App URL, endpoint and commands", async () => {
    mockSession({ loading: false, signedIn: true, githubLogin: "octocat" });
    mockedOperateFetch.mockResolvedValue({
      projects: PROJECTS,
      channels: [
        CHANNEL,
        {
          ...CHANNEL,
          id: "b2",
          externalBotId: "2",
          commandEndpoint: "https://api.world.inc/commands",
          commands: ["b", "p"],
        },
      ],
    });
    render(<ChannelsView />);
    const summaries = await screen.findAllByTestId("channel-command-summary");
    expect(summaries[0]).toHaveTextContent("Mini App: none");
    expect(summaries[0]).not.toHaveTextContent("endpoint");
    expect(summaries[1]).toHaveTextContent(
      "endpoint: https://api.world.inc/commands · /b /p",
    );
  });

  it("registers a channel sending only the filled command fields", async () => {
    mockSession({ loading: false, signedIn: true, githubLogin: "octocat" });
    mockedOperateFetch.mockResolvedValue({ projects: PROJECTS, channels: [] });
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(Response.json({ channel: CHANNEL }, { status: 201 }));
    render(<ChannelsView />);

    fireEvent.click(
      await screen.findByRole("button", { name: /add channel/i }),
    );
    fireEvent.change(screen.getByPlaceholderText(/paste botfather token/i), {
      target: { value: "123:abc" },
    });
    fireEvent.click(
      screen.getByRole("radio", { name: /select playground-example/i }),
    );
    fireEvent.change(screen.getByLabelText(/command endpoint/i), {
      target: { value: "https://api.world.inc/commands" },
    });
    fireEvent.click(screen.getByRole("button", { name: /register channel/i }));

    await screen.findByRole("button", { name: /add channel/i });
    const [, postInit] = fetchSpy.mock.calls.find(
      ([, init]) => init?.method === "POST",
    )!;
    const body = JSON.parse(String(postInit?.body));
    expect(body).toMatchObject({
      agentId: 11,
      commandEndpoint: "https://api.world.inc/commands",
    });
    expect(body).not.toHaveProperty("miniAppUrl");
    expect(body).not.toHaveProperty("commands");
    fetchSpy.mockRestore();
  });

  it("cancelling edit restores the draft", async () => {
    mockSession({ loading: false, signedIn: true, githubLogin: "octocat" });
    mockedOperateFetch.mockResolvedValue({
      projects: PROJECTS,
      channels: [CHANNEL],
    });
    render(<ChannelsView />);

    fireEvent.click(
      await screen.findByRole("button", { name: /change agents/i }),
    );
    expect(screen.getByText("Editing")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(
      screen.getByRole("button", { name: /change agents/i }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Editing")).not.toBeInTheDocument();
  });

  it("blocks saving when the channel's agent is no longer owned", async () => {
    mockSession({ loading: false, signedIn: true, githubLogin: "octocat" });
    mockedOperateFetch.mockResolvedValue({ projects: [], channels: [CHANNEL] });
    render(<ChannelsView />);
    fireEvent.click(
      await screen.findByRole("button", { name: /change agents/i }),
    );
    expect(screen.getByRole("button", { name: /^save/i })).toBeDisabled();
  });
});
