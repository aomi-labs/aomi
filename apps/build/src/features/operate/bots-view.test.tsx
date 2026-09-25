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
  handoverApp: "playground-example",
  miniAppUrl: null,
  commandEndpoint: null,
  commands: [],
  platformBotId: "8184083135",
  platformUsername: "chico_chico_bot",
  webhookUrl: "https://x",
  threadMode: "single",
  configurationVersion: 1,
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
      handoverApplicationId: 11,
      threadMode: "multi",
    });
    fetchSpy.mockRestore();
  });

  it("labels the radio as the handover app", async () => {
    mockSession({ loading: false, signedIn: true, githubLogin: "octocat" });
    mockedOperateFetch.mockResolvedValue({ projects: PROJECTS, bots: [BOT] });
    render(<BotsView />);
    fireEvent.click(
      await screen.findByRole("button", { name: /change apps/i }),
    );
    expect(
      screen.getByRole("radio", {
        name: /make playground-example .* the handover app/i,
      }),
    ).toBeChecked();
    expect(screen.getByText(/new chats start here/i)).toBeInTheDocument();
  });

  it("an untouched save omits the bot command fields", async () => {
    mockSession({ loading: false, signedIn: true, githubLogin: "octocat" });
    const configured = {
      ...BOT,
      miniAppUrl: "https://world.example/mini",
      commandEndpoint: "https://api.world.inc/commands",
      commands: ["b", "p"],
    };
    mockedOperateFetch.mockResolvedValue({
      projects: PROJECTS,
      bots: [configured],
    });
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(Response.json({ bot: configured }));
    render(<BotsView />);

    fireEvent.click(
      await screen.findByRole("button", { name: /change apps/i }),
    );
    // Fields are seeded from the bot, not from an app.
    expect(screen.getByLabelText(/mini app url/i)).toHaveValue(
      "https://world.example/mini",
    );
    expect(screen.getByLabelText(/command endpoint/i)).toHaveValue(
      "https://api.world.inc/commands",
    );
    expect(screen.getByLabelText(/custom commands/i)).toHaveValue("b, p");
    fireEvent.click(screen.getByRole("button", { name: /^save/i }));

    await screen.findByRole("button", { name: /change apps/i });
    const [, patchInit] = fetchSpy.mock.calls.find(
      ([, init]) => init?.method === "PATCH",
    )!;
    const body = JSON.parse(String(patchInit?.body));
    expect(body).toEqual({
      botId: "b1",
      applicationIds: [11],
      handoverApplicationId: 11,
      threadMode: "single",
    });
    fetchSpy.mockRestore();
  });

  it("re-seeds the card when the server's bot changes, so a stale draft is never sent back", async () => {
    mockSession({ loading: false, signedIn: true, githubLogin: "octocat" });
    mockedOperateFetch.mockResolvedValue({ projects: PROJECTS, bots: [BOT] });
    // The save response is what the server now holds: another admin (or the
    // backend) set a command endpoint and commands and bumped the version.
    const refreshed = {
      ...BOT,
      configurationVersion: 2,
      commandEndpoint: "https://api.world.inc/commands",
      commands: ["b"],
    };
    // A fresh Response per call: a body can only be read once.
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(() =>
        Promise.resolve(Response.json({ bot: refreshed })),
      );
    render(<BotsView />);

    fireEvent.click(
      await screen.findByRole("button", { name: /change apps/i }),
    );
    expect(screen.getByLabelText(/command endpoint/i)).toHaveValue("");
    fireEvent.click(screen.getByRole("button", { name: /^save/i }));
    await screen.findByRole("button", { name: /change apps/i });

    // Reopening edits the refreshed bot, not the draft from before the save.
    fireEvent.click(screen.getByRole("button", { name: /change apps/i }));
    expect(screen.getByLabelText(/command endpoint/i)).toHaveValue(
      "https://api.world.inc/commands",
    );
    expect(screen.getByLabelText(/custom commands/i)).toHaveValue("b");
    fireEvent.click(screen.getByRole("button", { name: /^save/i }));
    await screen.findByRole("button", { name: /change apps/i });

    const patches = fetchSpy.mock.calls
      .filter(([, init]) => init?.method === "PATCH")
      .map(([, init]) => JSON.parse(String(init?.body)));
    expect(patches).toHaveLength(2);
    // Neither save carried command fields: the first draft matched its seed,
    // and the second was re-seeded from the refreshed bot.
    for (const body of patches) {
      expect(body).not.toHaveProperty("commandEndpoint");
      expect(body).not.toHaveProperty("commands");
      expect(body).not.toHaveProperty("miniAppUrl");
    }
    fetchSpy.mockRestore();
  });

  it("sends only the edited command fields, clearing a URL as null", async () => {
    mockSession({ loading: false, signedIn: true, githubLogin: "octocat" });
    const configured = {
      ...BOT,
      miniAppUrl: "https://world.example/mini",
      commandEndpoint: "https://api.world.inc/commands",
      commands: ["b", "p"],
    };
    mockedOperateFetch.mockResolvedValue({
      projects: PROJECTS,
      bots: [configured],
    });
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(Response.json({ bot: configured }));
    render(<BotsView />);

    fireEvent.click(
      await screen.findByRole("button", { name: /change apps/i }),
    );
    fireEvent.change(screen.getByLabelText(/mini app url/i), {
      target: { value: "  " },
    });
    fireEvent.change(screen.getByLabelText(/custom commands/i), {
      target: { value: "/B, r chart" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^save/i }));

    await screen.findByRole("button", { name: /change apps/i });
    const [, patchInit] = fetchSpy.mock.calls.find(
      ([, init]) => init?.method === "PATCH",
    )!;
    const body = JSON.parse(String(patchInit?.body));
    expect(body).toMatchObject({
      miniAppUrl: null,
      commands: ["b", "r", "chart"],
    });
    expect(body).not.toHaveProperty("commandEndpoint");
    fetchSpy.mockRestore();
  });

  it("disables save when commands are set without an endpoint", async () => {
    mockSession({ loading: false, signedIn: true, githubLogin: "octocat" });
    mockedOperateFetch.mockResolvedValue({ projects: PROJECTS, bots: [BOT] });
    render(<BotsView />);

    fireEvent.click(
      await screen.findByRole("button", { name: /change apps/i }),
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

  it("reveals the command secret through the BFF route", async () => {
    mockSession({ loading: false, signedIn: true, githubLogin: "octocat" });
    mockedOperateFetch.mockResolvedValue({ projects: PROJECTS, bots: [BOT] });
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(Response.json({ commandSecret: "deadbeef" }));
    render(<BotsView />);

    fireEvent.click(
      await screen.findByRole("button", { name: /change apps/i }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: /reveal command secret/i }),
    );
    const field = await screen.findByLabelText(/command secret/i);
    expect(field).toHaveValue("deadbeef");
    expect(field).toHaveAttribute("readonly");
    expect(String(fetchSpy.mock.calls[0][0])).toBe(
      "/api/bff/operate/bots/b1/command-secret",
    );
    fetchSpy.mockRestore();
  });

  it("checks the webhook through the BFF route and reports a repair", async () => {
    mockSession({ loading: false, signedIn: true, githubLogin: "octocat" });
    mockedOperateFetch.mockResolvedValue({ projects: PROJECTS, bots: [BOT] });
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
    render(<BotsView />);

    fireEvent.click(
      await screen.findByRole("button", { name: /check webhook/i }),
    );
    const status = await screen.findByTestId("bot-webhook-status");
    expect(status).toHaveTextContent(
      "Webhook was not pointed at Aomi; re-pointed now · 3 pending updates · last Telegram error: Wrong response from the webhook: 404 Not Found",
    );
    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toBe("/api/bff/operate/bots/b1/webhook");
    expect(init?.method).toBe("POST");
    fetchSpy.mockRestore();
  });

  it("shows a failed webhook check without a status line", async () => {
    mockSession({ loading: false, signedIn: true, githubLogin: "octocat" });
    mockedOperateFetch.mockResolvedValue({ projects: PROJECTS, bots: [BOT] });
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        Response.json(
          { error: "Telegram did not answer the webhook query" },
          { status: 502 },
        ),
      );
    render(<BotsView />);

    fireEvent.click(
      await screen.findByRole("button", { name: /check webhook/i }),
    );
    expect(
      await screen.findByText("Telegram did not answer the webhook query"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("bot-webhook-status")).toBeNull();
    fetchSpy.mockRestore();
  });

  it("keeps a saved bot and shows the manager's webhook warning", async () => {
    mockSession({ loading: false, signedIn: true, githubLogin: "octocat" });
    mockedOperateFetch.mockResolvedValue({ projects: PROJECTS, bots: [BOT] });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({
        bot: { ...BOT, configurationVersion: 2 },
        webhookWarning: "Telegram setWebhook failed (502 Bad Gateway)",
      }),
    );
    render(<BotsView />);

    fireEvent.click(
      await screen.findByRole("button", { name: /change apps/i }),
    );
    fireEvent.click(screen.getByRole("button", { name: /^save/i }));
    await screen.findByRole("button", { name: /change apps/i });

    expect(
      screen.getByText(
        /saved, but the webhook was not re-asserted: telegram setwebhook failed \(502 bad gateway\)/i,
      ),
    ).toBeInTheDocument();
    fetchSpy.mockRestore();
  });

  it("keeps the save warning through a failed check and drops it after a good one", async () => {
    mockSession({ loading: false, signedIn: true, githubLogin: "octocat" });
    mockedOperateFetch.mockResolvedValue({ projects: PROJECTS, bots: [BOT] });
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        Response.json({
          bot: { ...BOT, configurationVersion: 2 },
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
    render(<BotsView />);

    fireEvent.click(
      await screen.findByRole("button", { name: /change apps/i }),
    );
    fireEvent.click(screen.getByRole("button", { name: /^save/i }));
    await screen.findByRole("button", { name: /change apps/i });
    const warning = () =>
      screen.queryByText(/saved, but the webhook was not re-asserted/i);
    expect(warning()).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /check webhook/i }));
    expect(
      await screen.findByText("Telegram did not answer"),
    ).toBeInTheDocument();
    expect(warning()).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /check webhook/i }));
    expect(await screen.findByTestId("bot-webhook-status")).toHaveTextContent(
      "Webhook OK · 0 pending updates",
    );
    expect(warning()).toBeNull();
    expect(screen.queryByText("Telegram did not answer")).toBeNull();
    fetchSpy.mockRestore();
  });

  it("read mode shows the effective Mini App URL, endpoint and commands", async () => {
    mockSession({ loading: false, signedIn: true, githubLogin: "octocat" });
    mockedOperateFetch.mockResolvedValue({
      projects: PROJECTS,
      bots: [
        BOT,
        {
          ...BOT,
          id: "b2",
          platformBotId: "2",
          commandEndpoint: "https://api.world.inc/commands",
          commands: ["b", "p"],
        },
      ],
    });
    render(<BotsView />);
    const summaries = await screen.findAllByTestId("bot-command-summary");
    expect(summaries[0]).toHaveTextContent("Mini App: Aomi default");
    expect(summaries[0]).not.toHaveTextContent("endpoint");
    expect(summaries[1]).toHaveTextContent(
      "endpoint: https://api.world.inc/commands · /b /p",
    );
  });

  it("registers a bot sending only the filled command fields", async () => {
    mockSession({ loading: false, signedIn: true, githubLogin: "octocat" });
    mockedOperateFetch.mockResolvedValue({ projects: PROJECTS, bots: [] });
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(Response.json({ bot: BOT }, { status: 201 }));
    render(<BotsView />);

    fireEvent.click(await screen.findByRole("button", { name: /add bot/i }));
    fireEvent.change(screen.getByPlaceholderText(/paste botfather token/i), {
      target: { value: "123:abc" },
    });
    fireEvent.click(
      screen.getByRole("checkbox", { name: /attach playground-example/i }),
    );
    fireEvent.change(screen.getByLabelText(/command endpoint/i), {
      target: { value: "https://api.world.inc/commands" },
    });
    fireEvent.click(screen.getByRole("button", { name: /register bot/i }));

    await screen.findByRole("button", { name: /add bot/i });
    const [, postInit] = fetchSpy.mock.calls.find(
      ([, init]) => init?.method === "POST",
    )!;
    const body = JSON.parse(String(postInit?.body));
    expect(body).toMatchObject({
      applicationIds: [11],
      handoverApplicationId: 11,
      commandEndpoint: "https://api.world.inc/commands",
    });
    expect(body).not.toHaveProperty("miniAppUrl");
    expect(body).not.toHaveProperty("commands");
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
