import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { AgentDetailView } from "./agent-detail-view";
import {
  agentConfigsFixture,
  needsRebuildAgentFixture,
  packageFixture,
  packageReleasesFixture,
  publisherFixture,
} from "./fixtures";
import { InventoryView } from "./inventory-view";
import { PackageDetailView } from "./package-detail-view";
import { callsLabel } from "./usage-view";

type Answer = { status?: number; body: unknown };
let routes: Record<string, Answer>;
const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
  const answer = routes[`${init?.method ?? "GET"} ${input}`];
  if (!answer) throw new Error(`unexpected ${init?.method ?? "GET"} ${input}`);
  return Response.json(answer.body, { status: answer.status ?? 200 });
});

beforeEach(() => {
  fetchMock.mockClear();
  routes = {
    "GET /api/build/publishers/me": { body: publisherFixture },
    "GET /api/build/packages/trade": { body: packageFixture },
    "GET /api/build/packages/trade/releases": {
      body: { package: "arixoneth/trade", ...packageReleasesFixture },
    },
    "GET /api/build/agents/dottie": { body: needsRebuildAgentFixture },
    "GET /api/build/agents/dottie/configs": {
      body: {
        agent: "arixoneth/dottie",
        live: agentConfigsFixture.live,
        configs: agentConfigsFixture.releases,
      },
    },
  };
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => vi.unstubAllGlobals());

function renderWithQueries(ui: ReactNode) {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      {ui}
    </QueryClientProvider>,
  );
}

it("lists the publisher's agents and packages apart", async () => {
  const agents = renderWithQueries(<InventoryView only="agents" />);
  expect(await screen.findByText("Hoodit")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Hoodit" })).toHaveAttribute(
    "href",
    "/agents/hoodit",
  );
  expect(screen.getByText("Needs a rebuild")).toBeInTheDocument();
  expect(screen.queryByText("Trade")).not.toBeInTheDocument();
  agents.unmount();

  renderWithQueries(<InventoryView only="packages" />);
  expect(
    await screen.findByRole("link", { name: /trade$/ }),
  ).toHaveAttribute("href", "/packages/trade");
  expect(screen.getByText("No release live")).toBeInTheDocument();
  expect(
    screen.queryByRole("link", { name: "Hoodit" }),
  ).not.toBeInTheDocument();
});

it("tells the builder an agent carried over from an earlier deployment needs a rebuild", async () => {
  renderWithQueries(<AgentDetailView name="dottie" />);
  expect(
    await screen.findByText(/Needs a rebuild: this agent was carried over/),
  ).toBeInTheDocument();
  // Packages first, then the agent: `--agent` alone publishes no package.
  expect(
    screen.getAllByRole("listitem").map((item) => item.textContent),
  ).toEqual([
    "aomi build publish --promote --package <package> for each package it lists",
    "aomi build publish --promote --agent dottie",
  ]);
  expect(
    screen.queryByRole("button", { name: /save/i }),
  ).not.toBeInTheDocument();
  expect(await screen.findByText(/#3 · 37be02/)).toBeInTheDocument();
});

it("offers a republish when the agent it extends has moved on", async () => {
  routes["GET /api/build/agents/dottie"] = {
    body: {
      ...needsRebuildAgentFixture,
      agent: { ...needsRebuildAgentFixture.agent, status: "active" },
      base: { agent: "aomi/main", pinned: 3, live: 5 },
    },
  };
  renderWithQueries(<AgentDetailView name="dottie" />);
  expect(
    await screen.findByText(
      /config 5 is live now\. Republish to take its packages/,
    ),
  ).toHaveTextContent("Built on aomi/main config 3");
  expect(
    screen.getByText("aomi build publish --promote --agent dottie"),
  ).toBeInTheDocument();
});

it("names no source when the live release was published without one", async () => {
  routes["GET /api/build/packages/trade"] = {
    body: {
      ...packageFixture,
      live: { ...packageFixture.live, source_repo: null, commit: null },
    },
  };
  renderWithQueries(<PackageDetailView name="trade" />);
  expect(await screen.findByText(/no source recorded/)).toBeInTheDocument();
  expect(
    screen.queryByRole("link", { name: "Edit in GitHub" }),
  ).not.toBeInTheDocument();
});

it("says so when the live release moved before a promote", async () => {
  routes["POST /api/build/packages/trade/promote"] = {
    status: 409,
    body: { code: "live_changed", message: "live moved", live: 6 },
  };
  renderWithQueries(<PackageDetailView name="trade" />);
  fireEvent.click(await screen.findByRole("tab", { name: "Releases" }));
  await screen.findByText("#6 · 6a3f9c");
  fireEvent.click(screen.getByRole("button", { name: "Promote" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "The live release moved to #6 since this page loaded. Nothing was promoted",
  );
  const promote = fetchMock.mock.calls.find(
    ([, init]) => init?.method === "POST",
  )!;
  expect(JSON.parse(String(promote[1]!.body))).toEqual({
    release: 6,
    expected_live: 5,
  });
  expect(screen.getByRole("button", { name: "Roll back" })).toBeInTheDocument();
});

it("replaces a builder secret through the package's secret route, never showing the value", async () => {
  routes["PUT /api/build/packages/trade/secrets/GMGN_API_KEY"] = {
    body: { slot: "GMGN_API_KEY", status: "set" },
  };
  renderWithQueries(<PackageDetailView name="trade" />);
  fireEvent.click(await screen.findByRole("tab", { name: "Guards" }));
  expect(screen.getByText("api.gmgn.ai")).toBeInTheDocument();
  expect(screen.getByRole("img", { name: "Verified" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("tab", { name: "Secrets" }));
  expect(screen.getByText("Users add their own")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Add value" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Replace" }));
  fireEvent.change(screen.getByLabelText("New value for GMGN_API_KEY"), {
    target: { value: "new-secret" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(
    await screen.findByRole("button", { name: "Replace" }),
  ).toBeInTheDocument();
  const put = fetchMock.mock.calls.find(([, init]) => init?.method === "PUT")!;
  expect(put[0]).toBe("/api/build/packages/trade/secrets/GMGN_API_KEY");
  expect(JSON.parse(String(put[1]!.body))).toEqual({ value: "new-secret" });
  expect(screen.queryByDisplayValue("new-secret")).not.toBeInTheDocument();
});

it("draws the package's icon as the Library does and checks an SVG before it is committed", async () => {
  renderWithQueries(<PackageDetailView name="trade" />);
  await screen.findByRole("heading", { name: "trade" });
  const marks = document.querySelectorAll<HTMLElement>("[data-package-icon]");
  expect([...marks].map((mark) => mark.dataset.packageIcon)).toEqual([
    "/api/packages/arixoneth%2Ftrade/icon",
    "/api/packages/arixoneth%2Ftrade/icon",
  ]);
  expect(document.querySelector("img")).toBeNull();

  const input = screen.getByLabelText("SVG icon");
  // jsdom's File has no arrayBuffer().
  const file = (text: string) =>
    Object.assign(new File([text], "logo.svg"), {
      arrayBuffer: async () => new TextEncoder().encode(text).buffer,
    });
  const red = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="red"/></svg>';
  fireEvent.change(input, { target: { files: [file(red)] } });
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "logo.svg: the colour fill: red is not allowed; use currentColor or none",
  );

  const createObjectURL = vi.fn(() => "blob:icon");
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() }));
  const good = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="currentColor"/></svg>';
  fireEvent.change(input, { target: { files: [file(good)] } });
  expect(await screen.findByText(/logo\.svg passes/)).toBeInTheDocument();
  expect(
    [...document.querySelectorAll<HTMLElement>("[data-package-icon]")].map(
      (mark) => mark.dataset.packageIcon,
    ),
  ).toContain("blob:icon");
});

it("shows a package's call counts, unavailable before counting started", () => {
  const today = new Date("2026-12-01T12:00:00Z");
  const calls = packageFixture.calls!;
  expect(callsLabel(calls, today)).toEqual({ count: "42 · 2 errors", note: "Since 2026-11-23" });
  expect(callsLabel({ ...calls, coverage_from: "2026-10-01" }, today).note).toBeNull();
  expect(callsLabel({ ...calls, coverage_from: null }, today).count).toBe("Unavailable");
  expect(callsLabel(null, today).count).toBe("Unavailable");
});
