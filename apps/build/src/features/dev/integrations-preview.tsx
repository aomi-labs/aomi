// Visual harness for the REAL Integrations page (same pattern as
// /dev/operate-preview): window.fetch is stubbed to serve the operate/channels
// Build API wire shape from in-memory fixtures, so the actual IntegrationsView —
// including add/edit/remove flows — is fully interactive without a GitHub
// session or backend. Design iteration happened here before the port; this
// file now only carries fixtures + the theme switch.

import { cn } from "@aomi-labs/widget";
import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { GitHubSessionProvider } from "@/components/control-plane/github-session-context";
import { IntegrationsView } from "@/features/integrations/integrations-view";
import {
  readColorTheme,
  saveColorTheme,
  type ColorTheme,
} from "@/lib/color-theme";

const SESSION = {
  signedIn: true,
  githubLogin: "ceciliaz030",
  githubAvatarUrl: null,
  installationId: 1,
};

const SOURCES = [
  {
    id: 1,
    repositoryLink: "ceciliaz030/local-8",
    agents: [
      { id: 11, name: "playground-example" },
      { id: 12, name: "goal-digger" },
    ],
  },
  {
    id: 2,
    repositoryLink: "ceciliaz030/local-6",
    agents: [{ id: 21, name: "playground-example" }],
  },
  {
    id: 3,
    repositoryLink: "ceciliaz030/local-7",
    agents: [{ id: 22, name: "somm-agent" }],
  },
];

function agentFor(id: number) {
  const source = SOURCES.find((source) =>
    source.agents.some((agent) => agent.id === id),
  );
  const agent = source?.agents.find((agent) => agent.id === id);
  return {
    id,
    projectId: source?.id ?? null,
    projectLabel: source?.repositoryLink ?? null,
    name: agent?.name ?? "gone-agent",
    displayName: agent?.name ?? "gone-agent",
    platform: "community",
  };
}

let CHANNELS = [
  {
    id: "b1",
    kind: "telegram",
    status: "active",
    label: null as string | null,
    agentId: 11,
    miniAppUrl: null as string | null,
    commandEndpoint: null as string | null,
    commands: [] as string[],
    agent: agentFor(11),
    externalBotId: "8184083135",
    platformUsername: "chico_chico_bot",
    webhookUrl: "https://api.example.test/api/bots/telegram/secret",
    threadMode: "single",
    createdAt: 1_753_000_000,
  },
  {
    id: "b2",
    kind: "telegram",
    status: "active",
    label: "Trading assistant" as string | null,
    agentId: 22,
    miniAppUrl: null as string | null,
    commandEndpoint: "https://api.somm.example/commands" as string | null,
    commands: ["b", "p"] as string[],
    agent: agentFor(22),
    externalBotId: "7729918454",
    platformUsername: "trade_helper_bot",
    webhookUrl: "https://api.example.test/api/bots/telegram/secret2",
    threadMode: "multi",
    createdAt: 1_753_100_000,
  },
];

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
    const method = (init?.method ?? "GET").toUpperCase();

    if (url.includes("/api/build/auth/github/status"))
      return Response.json(SESSION);

    if (url.includes("/api/build/operate/channels")) {
      if (method === "GET" && url.includes("/command-secret"))
        return Response.json({ commandSecret: "preview-secret-0000" });
      if (method === "POST" && url.includes("/webhook"))
        return Response.json({
          webhook: {
            urlMatches: false,
            pendingUpdateCount: 4,
            lastErrorMessage: "Wrong response from the webhook: 404 Not Found",
            reasserted: true,
            warning: null,
          },
        });
      if (method === "GET")
        return Response.json({ projects: SOURCES, channels: CHANNELS });
      if (method === "POST") {
        const body = JSON.parse(String(init?.body ?? "{}")) as {
          label?: string;
          threadMode?: string;
          agentId: number;
          miniAppUrl?: string | null;
          commandEndpoint?: string | null;
          commands?: string[];
        };
        const channel = {
          id: `new-${CHANNELS.length + 1}`,
          kind: "telegram",
          status: "active",
          label: body.label ?? null,
          agentId: body.agentId,
          miniAppUrl: body.miniAppUrl ?? null,
          commandEndpoint: body.commandEndpoint ?? null,
          commands: body.commands ?? [],
          agent: agentFor(body.agentId),
          externalBotId: "5550001234",
          platformUsername: "your_new_bot",
          webhookUrl: "https://api.example.test/api/bots/telegram/secret3",
          threadMode: body.threadMode ?? "single",
          createdAt: 1_753_200_000,
        };
        CHANNELS = [channel, ...CHANNELS];
        return Response.json({ channel }, { status: 201 });
      }
      if (method === "PATCH") {
        const body = JSON.parse(String(init?.body ?? "{}")) as {
          channelId: string;
          agentId: number;
          threadMode?: string;
          miniAppUrl?: string | null;
          commandEndpoint?: string | null;
          commands?: string[];
        };
        const channel = CHANNELS.find((b) => b.id === body.channelId);
        if (!channel)
          return Response.json({ error: "not found" }, { status: 404 });
        channel.agent = agentFor(body.agentId);
        channel.agentId = body.agentId;
        if (body.threadMode) channel.threadMode = body.threadMode;
        if (body.miniAppUrl !== undefined) channel.miniAppUrl = body.miniAppUrl;
        if (body.commandEndpoint !== undefined)
          channel.commandEndpoint = body.commandEndpoint;
        if (body.commands !== undefined) channel.commands = body.commands;
        return Response.json({ channel });
      }
      if (method === "DELETE") {
        const channelId = new URL(url, window.location.origin).searchParams.get(
          "channelId",
        );
        CHANNELS = CHANNELS.filter((b) => b.id !== channelId);
        return Response.json({ ok: true });
      }
    }
    return real(input, init);
  };
}

function ThemeSwitch() {
  const [theme, setTheme] = useState<ColorTheme>("dark");
  useEffect(() => {
    setTheme(readColorTheme());
  }, []);
  const set = (next: ColorTheme) => {
    saveColorTheme(next);
    setTheme(next);
  };
  return (
    <div className="border-border bg-surface inline-flex h-8 items-center rounded-full border p-1">
      {(
        [
          ["light", Sun],
          ["dark", Moon],
        ] as const
      ).map(([mode, Icon]) => (
        <button
          key={mode}
          type="button"
          aria-label={`Switch to ${mode} mode`}
          aria-pressed={theme === mode}
          onClick={() => set(mode)}
          className={cn(
            "flex size-6 items-center justify-center rounded-full transition-colors",
            theme === mode
              ? "bg-aomi-accent text-aomi-on-accent"
              : "text-aomi-muted hover:text-foreground",
          )}
        >
          <Icon className="size-3.5" aria-hidden />
        </button>
      ))}
    </div>
  );
}

export default function IntegrationsPreview() {
  const [client] = useState(() => {
    stubFetch();
    return new QueryClient();
  });
  return (
    <QueryClientProvider client={client}>
      <GitHubSessionProvider>
        <main className="bg-background min-h-screen">
          <div className="mx-auto flex w-full max-w-6xl justify-end px-4 pt-4 sm:px-6 lg:px-8">
            <ThemeSwitch />
          </div>
          <IntegrationsView />
        </main>
      </GitHubSessionProvider>
    </QueryClientProvider>
  );
}
