import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AddPrivateAppDialog } from "./add-private-app-dialog";
const fixture = vi.hoisted(() => ({
  apps: [] as { applicationId: number }[],
  add: vi.fn(),
  fetch: vi.fn(),
}));
vi.mock("@aomi-labs/react", async (original) => ({
  ...(await original<typeof import("@aomi-labs/react")>()),
  usePrivateApps: () => ({ apps: fixture.apps, add: fixture.add }),
}));
vi.mock("@/account/transport", () => ({
  useShellTransport: () => ({ fetch: fixture.fetch }),
}));
vi.mock("@/account/account-overview", () => ({
  useAccountOverview: () => null,
  useAccountOverviewStore: () => ({ updateAccountApps: vi.fn() }),
}));
const row = {
  name: "treasury",
  label: "Treasury Ops",
  application_id: 42,
  is_public: false,
  is_active: true,
  artifact_ready: true,
};
beforeEach(() => {
  fixture.apps = [];
  fixture.add.mockReset();
  fixture.fetch.mockReset();
});
afterEach(cleanup);
function open(target?: { app?: string; applicationId?: number }) {
  render(<AddPrivateAppDialog open onOpenChange={vi.fn()} target={target} />);
  fireEvent.change(screen.getByLabelText("App key"), {
    target: { value: " shared-secret " },
  });
  fireEvent.click(screen.getByRole("button", { name: "Add app" }));
}
it("resolves identity through a header and adds the exact private app", async () => {
  fixture.fetch.mockResolvedValue(Response.json([row]));
  open();
  expect(await screen.findByText("Treasury Ops")).toBeTruthy();
  expect(fixture.fetch).toHaveBeenCalledWith(
    "/api/thread/apps?resolve_key=true",
    {
      headers: { "Aomi-App-Key": "shared-secret" },
      signal: expect.any(AbortSignal),
    },
  );
  expect(fixture.add).toHaveBeenCalledWith(
    expect.objectContaining({ applicationId: 42, name: "treasury" }),
    "shared-secret",
  );
  expect(screen.queryByLabelText("App key")).toBeNull();
});
it.each([401, 403, 404, 409, 422, 503])(
  "keeps failed resolution %s in the dialog without adding an app",
  async (status) => {
    fixture.fetch.mockResolvedValue(new Response(null, { status }));
    open();
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(fixture.add).not.toHaveBeenCalled();
  },
);
it("refuses a different application even when its name matches", async () => {
  fixture.fetch.mockResolvedValue(Response.json([row]));
  open({ app: "treasury", applicationId: 43 });
  expect(await screen.findByRole("alert")).toHaveTextContent("different app");
  expect(fixture.add).not.toHaveBeenCalled();
});
it("does not accept an old server's public catalog as validation", async () => {
  fixture.fetch.mockResolvedValue(Response.json([{ ...row, is_public: true }]));
  open();
  expect(await screen.findByRole("alert")).toBeTruthy();
  expect(fixture.add).not.toHaveBeenCalled();
});
it("blocks repeated submissions while resolving and explains duplicates", async () => {
  let resolve!: (response: Response) => void;
  fixture.apps = [{ applicationId: 42 }];
  fixture.fetch.mockReturnValue(
    new Promise<Response>((done) => {
      resolve = done;
    }),
  );
  open();
  expect(screen.getByRole("button", { name: "Adding app…" })).toBeDisabled();
  resolve(Response.json([row]));
  await waitFor(() =>
    expect(screen.getByRole("status")).toHaveTextContent(
      "Already in your Library",
    ),
  );
  expect(fixture.add).toHaveBeenCalledTimes(1);
});
