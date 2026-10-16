import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AomiClient, type AomiAccountWallet } from "@aomi-labs/client";
import { AgentWalletRuleCard, ruleCardTitle } from "./agent-wallet-rules";
import { ConnectedApps } from "./connected-apps";

const wallet: AomiAccountWallet = {
  id: "w_12",
  kind: "agent",
  family: "evm",
  address: "0x7a3f00000000000000000000000000000000c41e",
  label: "Agent wallet",
  custom_label: null,
  wallet_app: null,
  provider: "para",
  is_default: true,
  status: "ready",
  merged: false,
  rule: { mode: "ask", rule_version: 3, instant: [] },
  created_at: 1_760_000_000,
};

const rule = (overrides: Record<string, unknown> = {}) => ({
  id: "w_12",
  rule_version: 3,
  paused: false,
  clients: [
    { client: "portal", kind: "portal", label: "Portal", instant: false },
    { client: "cli", kind: "cli", label: "CLI", instant: false },
    { client: "mcp", kind: "mcp", label: "AI clients (MCP)", instant: false },
    {
      client: "telegram:7712345678",
      kind: "telegram",
      label: "@HooditBot",
      instant: true,
      detail: "kept on from the beta",
    },
  ],
  ...overrides,
});

type Route = (body: unknown) => Response;

function backend(routes: Record<string, Route | Route[]>) {
  const calls: { method: string; path: string; body: unknown }[] = [];
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, path: url.pathname, body });
    const route = routes[`${method} ${url.pathname}`];
    const handler = Array.isArray(route) ? route.shift() : route;
    return handler
      ? handler(body)
      : Response.json({ error: "unexpected" }, { status: 500 });
  }) as typeof globalThis.fetch;
  const client = new AomiClient({
    baseUrl: "https://portal.test",
    guest: false,
    fetch,
  });
  return { client, calls };
}

const writes = (calls: { method: string; body: unknown }[]) =>
  calls.filter((call) => call.method === "PUT").map((call) => call.body);

async function renderCard(routes: Record<string, Route | Route[]>) {
  const { client, calls } = backend(routes);
  await act(async () => {
    render(
      <AgentWalletRuleCard
        client={client}
        wallet={wallet}
        title={ruleCardTitle(wallet, false)}
      />,
    );
  });
  await screen.findByText("Ask before each trade");
  return calls;
}

const instantSwitch = (name: string) =>
  screen.getByRole("switch", { name: `Instant for ${name}` });

describe("Agent wallet rule card", () => {
  it("shows Ask always on, Pause and one Instant switch per client", async () => {
    await renderCard({
      "GET /v1/account/wallets/w_12/rule": () => Response.json(rule()),
    });

    expect(screen.getByRole("heading", { name: "Agent wallet" })).toBeTruthy();
    expect(screen.getByText("Always on")).toBeTruthy();
    expect(
      screen.getByRole("switch", { name: "Pause Agent wallet" }),
    ).toHaveAttribute("aria-checked", "false");
    expect(
      screen
        .getAllByRole("switch", { name: /^Instant for / })
        .map((item) => [
          item.getAttribute("aria-label"),
          item.getAttribute("aria-checked"),
        ]),
    ).toEqual([
      ["Instant for Portal", "false"],
      ["Instant for CLI", "false"],
      ["Instant for AI clients (MCP)", "false"],
      ["Instant for Telegram · @HooditBot", "true"],
    ]);
    expect(
      screen.getByText("All connected AI clients share this switch"),
    ).toBeTruthy();
    expect(screen.getByText("kept on from the beta")).toBeTruthy();
  });

  it("asks before turning Instant on and writes the whole rule at its version", async () => {
    const calls = await renderCard({
      "GET /v1/account/wallets/w_12/rule": () => Response.json(rule()),
      "PUT /v1/account/wallets/w_12/rule": (body) =>
        Response.json(
          rule({
            rule_version: 4,
            clients: rule().clients.map((client) => ({
              ...client,
              instant: (body as { instant: string[] }).instant.includes(
                client.client,
              ),
            })),
          }),
        ),
    });

    await act(async () => fireEvent.click(instantSwitch("Portal")));
    const dialog = screen.getByRole("alertdialog", {
      name: "Sign without asking?",
    });
    expect(dialog).toHaveTextContent(
      "Trades from Portal will sign without asking.",
    );
    await act(async () =>
      fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" })),
    );
    expect(writes(calls)).toEqual([]);

    await act(async () => fireEvent.click(instantSwitch("Portal")));
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: "Turn on" })),
    );
    expect(writes(calls)).toEqual([
      {
        rule_version: 3,
        paused: false,
        instant: ["telegram:7712345678", "portal"],
      },
    ]);
    await waitFor(() =>
      expect(instantSwitch("Portal")).toHaveAttribute("aria-checked", "true"),
    );

    // Turning a client off needs no confirmation.
    await act(async () =>
      fireEvent.click(instantSwitch("Telegram · @HooditBot")),
    );
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(writes(calls).at(-1)).toEqual({
      rule_version: 4,
      paused: false,
      instant: ["portal"],
    });
  });

  it("pauses with Instant clients kept, and dims the switches", async () => {
    const calls = await renderCard({
      "GET /v1/account/wallets/w_12/rule": () => Response.json(rule()),
      "PUT /v1/account/wallets/w_12/rule": () =>
        Response.json(rule({ rule_version: 4, paused: true })),
    });
    await act(async () =>
      fireEvent.click(
        screen.getByRole("switch", { name: "Pause Agent wallet" }),
      ),
    );
    expect(writes(calls)).toEqual([
      { rule_version: 3, paused: true, instant: ["telegram:7712345678"] },
    ]);
    await screen.findByText("Paused: nothing signs until you resume");
    expect(instantSwitch("Portal")).toBeDisabled();
  });

  it("reads the rule again after a version conflict", async () => {
    const calls = await renderCard({
      "GET /v1/account/wallets/w_12/rule": [
        () => Response.json(rule()),
        () => Response.json(rule({ rule_version: 5, paused: true })),
      ],
      "PUT /v1/account/wallets/w_12/rule": () =>
        Response.json({ error: "rule_version_conflict" }, { status: 409 }),
    });
    await act(async () =>
      fireEvent.click(
        screen.getByRole("switch", { name: "Pause Agent wallet" }),
      ),
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "This rule changed elsewhere. Check it and try again.",
    );
    expect(
      calls.filter((call) => call.method === "GET").map((call) => call.path),
    ).toHaveLength(2);
    expect(
      screen.getByRole("switch", { name: "Pause Agent wallet" }),
    ).toHaveAttribute("aria-checked", "true");
  });

  it("titles several wallets by family and address", () => {
    expect(ruleCardTitle(wallet, true)).toBe("Agent wallet · EVM 0x7a3f…c41e");
    expect(
      ruleCardTitle(
        { ...wallet, family: "svm", address: "7xKpQ1111111111111111111111111" },
        true,
      ),
    ).toMatch(/^Agent wallet · SVM 7xKp/);
  });
});

describe("Connected apps", () => {
  const connections = {
    oauth: [
      {
        client_id: "claude-code",
        name: "Claude Code",
        kind: "mcp",
        connected_at: 1_760_400_000,
      },
      { client_id: "aomi-cli", name: "Aomi CLI", kind: "cli", connected_at: 1 },
    ],
    telegram: {
      username: "arixon",
      bots: [{ bot_id: "7712345678", label: "@HooditBot" }],
    },
  };

  it("lists each OAuth client once with its kind, and Telegram once", async () => {
    const { client } = backend({
      "GET /v1/account/connections": () => Response.json(connections),
    });
    await act(async () => {
      render(<ConnectedApps client={client} />);
    });
    expect(await screen.findByText("Claude Code")).toBeTruthy();
    expect(screen.getByText("MCP")).toBeTruthy();
    expect(screen.getByText("CLI")).toBeTruthy();
    expect(
      screen.getByText("Your Telegram account · used in @HooditBot"),
    ).toBeTruthy();
    expect(screen.queryByText(/Send \/link/)).toBeNull();
    // Telegram has no Unlink yet; only OAuth clients disconnect.
    expect(screen.getAllByRole("button", { name: "Disconnect" })).toHaveLength(
      2,
    );
  });

  it("disconnects one client after confirmation and reloads the list", async () => {
    const { client, calls } = backend({
      "GET /v1/account/connections": [
        () => Response.json(connections),
        () =>
          Response.json({ ...connections, oauth: connections.oauth.slice(1) }),
      ],
      "DELETE /v1/account/connections/oauth/claude-code": () =>
        Response.json({ revoked: true }),
    });
    await act(async () => {
      render(<ConnectedApps client={client} />);
    });
    await screen.findByText("Claude Code");
    await act(async () =>
      fireEvent.click(
        screen.getAllByRole("button", { name: "Disconnect" })[0]!,
      ),
    );
    const dialog = screen.getByRole("alertdialog", {
      name: "Disconnect Claude Code?",
    });
    await act(async () =>
      fireEvent.click(
        within(dialog).getByRole("button", { name: "Disconnect" }),
      ),
    );
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      "GET /v1/account/connections",
      "DELETE /v1/account/connections/oauth/claude-code",
      "GET /v1/account/connections",
    ]);
    await waitFor(() => expect(screen.queryByText("Claude Code")).toBeNull());
  });

  it("says when nothing is connected", async () => {
    const { client } = backend({
      "GET /v1/account/connections": () =>
        Response.json({ oauth: [], telegram: null }),
    });
    await act(async () => {
      render(<ConnectedApps client={client} />);
    });
    expect(await screen.findByText("No apps connected.")).toBeTruthy();
    expect(
      screen.getByText(
        "Use Aomi in Telegram? Send /link to any Aomi app bot to add it here.",
      ),
    ).toBeTruthy();
  });
});
