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
  expect(await screen.findByRole("link", { name: "Hoodit" })).toHaveAttribute(
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
  expect(screen.getByText("aomi publish --agent dottie")).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: /save/i }),
  ).not.toBeInTheDocument();
  expect(await screen.findByText(/#3 · 37be02/)).toBeInTheDocument();
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
  expect(await screen.findByText("Users add their own")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Add value" })).toBeInTheDocument();
  expect(screen.getByText("Verified")).toBeInTheDocument();
  expect(screen.getByText("api.gmgn.ai")).toBeInTheDocument();
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
