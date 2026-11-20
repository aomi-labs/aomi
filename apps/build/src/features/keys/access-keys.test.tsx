import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { publisherFixture } from "@/features/packages/fixtures";

import { AccessKeys } from "./access-keys";

const CODES = "/api/build/packages/token-notes/codes";
type Call = { method: string; url: string; body: unknown };
let calls: Call[];
let routes: Record<string, unknown>;

beforeEach(() => {
  calls = [];
  routes = {
    "GET /api/build/publishers/me": publisherFixture,
    [`GET ${CODES}`]: {
      package: "arixoneth/token-notes",
      codes: [
        {
          id: 4,
          agent: null,
          created_at: "2026-11-20T10:00:00Z",
          revoked_at: null,
          grants: [
            {
              id: 9,
              account: "5f0c2a71-0000",
              agent: null,
              created_at: "2026-11-20T11:00:00Z",
              revoked_at: null,
            },
            {
              id: 10,
              account: "77aa0000-0000",
              agent: null,
              created_at: "2026-11-20T11:00:00Z",
              revoked_at: "2026-11-20T12:00:00Z",
            },
          ],
        },
      ],
    },
    [`POST ${CODES}`]: {
      id: 5,
      package: "arixoneth/token-notes",
      code: "1f3a9c2e-00000000-11111111-22222222",
      agent: null,
      created_at: "2026-11-20T13:00:00Z",
    },
    [`DELETE ${CODES}/4`]: { revoked: 2 },
    "DELETE /api/build/packages/token-notes/grants/9": { revoked: true },
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      calls.push({
        method,
        url,
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });
      const answer = routes[`${method} ${url}`];
      if (!answer) throw new Error(`unexpected ${method} ${url}`);
      return Response.json(answer);
    }),
  );
});

afterEach(() => vi.unstubAllGlobals());

function renderCard() {
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <AccessKeys />
    </QueryClientProvider>,
  );
}

it("lists a private package's codes with their holders and shows a new code once", async () => {
  renderCard();
  expect(await screen.findByText("1 holder")).toBeInTheDocument();
  // The code's row and the private package to make a code for; a listed
  // package needs no code.
  expect(screen.getAllByText("Token notes")).toHaveLength(2);
  expect(screen.queryByText("Trade")).not.toBeInTheDocument();
  expect(screen.getByText("5f0c2a71")).toBeInTheDocument();
  expect(screen.queryByText("77aa0000")).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "New access key" }));
  expect(
    await screen.findByText("Copy this code now. It is not shown again."),
  ).toBeInTheDocument();
  expect(
    screen.getByText("1f3a9c2e-00000000-11111111-22222222"),
  ).toBeInTheDocument();
  expect(calls.find((call) => call.method === "POST")?.body).toEqual({});
});

it("revokes a code and removes one person's access", async () => {
  renderCard();
  fireEvent.click(await screen.findByRole("button", { name: "Revoke" }));
  await waitFor(() =>
    expect(calls.map((call) => `${call.method} ${call.url}`)).toContain(
      `DELETE ${CODES}/4`,
    ),
  );
  fireEvent.click(screen.getByRole("button", { name: "Remove" }));
  await waitFor(() =>
    expect(calls.map((call) => `${call.method} ${call.url}`)).toContain(
      "DELETE /api/build/packages/token-notes/grants/9",
    ),
  );
});
