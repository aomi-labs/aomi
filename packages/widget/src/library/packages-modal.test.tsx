import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { AomiPackage } from "@aomi-labs/client";
import { PackagesModal } from "@/library/packages-modal";
import {
  AccountOverviewFixture,
  seedAccountOverview,
} from "@/test/account-overview-fixture";
import {
  AGENT_LISTED,
  NEEDS_KEY,
  NOT_VERIFIED,
  VERIFIED,
  catalog,
} from "@/test/package-fixtures";

type Call = { method: string; path: string; body: unknown };

/** The Library backend: rows change as the person switches and connects. */
function installBackend(initial: AomiPackage[]) {
  let rows = initial.map((row) => ({ ...row }));
  const calls: Call[] = [];
  const update = (id: number, change: Partial<AomiPackage>) => {
    rows = rows.map((row) =>
      row.package_id === id ? { ...row, ...change } : row,
    );
    return rows.find((row) => row.package_id === id);
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(input.toString(), "https://portal.test");
      const method = init?.method ?? "GET";
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ method, path: url.pathname, body });
      if (url.pathname === "/api/account/packages")
        return Response.json(catalog(rows));
      const choice = url.pathname.match(
        /^\/api\/account\/packages\/(\d+)\/choice$/,
      );
      if (choice && method === "PUT") {
        const id = Number(choice[1]);
        if (rows.find((row) => row.package_id === id)?.agent_listed)
          return Response.json({ error: "agent_listed" }, { status: 409 });
        const enabled = (body as { enabled: boolean }).enabled;
        return Response.json(
          update(id, {
            choice: enabled,
            enabled,
            reason: enabled ? "chosen_on" : "chosen_off",
          }),
        );
      }
      const secret = url.pathname.match(
        /^\/api\/account\/packages\/(\d+)\/secrets\/(\w+)$/,
      );
      if (secret && method === "PUT") {
        const id = Number(secret[1]);
        const row = rows.find((candidate) => candidate.package_id === id)!;
        update(id, {
          slots: row.slots.map((slot) =>
            slot.name === secret[2] ? { ...slot, status: "ready" } : slot,
          ),
        });
        return Response.json({ slot: secret[2], status: "ready" });
      }
      return new Response(`Unexpected ${method} ${url.pathname}`, {
        status: 500,
      });
    }),
  );
  return {
    calls,
    writes: () => calls.filter((call) => call.method !== "GET"),
    reads: () =>
      calls.filter((call) => call.path === "/api/account/packages").length,
    setRows: (next: AomiPackage[]) => {
      rows = next;
    },
  };
}

async function renderModal() {
  const view = render(<PackagesModal onClose={() => undefined} />, {
    wrapper: AccountOverviewFixture,
  });
  await act(async () => {});
  await waitFor(() =>
    expect(
      screen.queryByRole("status", { name: "Loading library" }),
    ).toBeNull(),
  );
  return view;
}

const rowSwitch = (name: string) =>
  within(
    screen.getByRole("button", { name: `Open ${name} details` }).parentElement!,
  ).getByRole("switch");

describe("packages modal", () => {
  beforeEach(() => {
    seedAccountOverview({ user: { user_id: "acct-1" } });
  });

  afterEach(async () => {
    cleanup();
    vi.unstubAllGlobals();
    localStorage.clear();
    await act(async () => {
      seedAccountOverview(null);
    });
  });

  it("shows the three groups and keeps agent-listed packages on", async () => {
    installBackend([NOT_VERIFIED, VERIFIED, AGENT_LISTED]);
    await renderModal();
    const headings = screen
      .getAllByRole("heading", { level: 2 })
      .map((heading) => heading.textContent);
    expect(headings.join("|")).toMatch(/Used by Aomi.*Verified.*Not verified/);
    expect(rowSwitch("Aave")).toBeDisabled();
    expect(rowSwitch("Aave")).toHaveAttribute("aria-checked", "true");
    expect(rowSwitch("Jupiter")).toBeEnabled();
    fireEvent.click(screen.getByLabelText("Open Aave details"));
    expect(
      screen.getByText(/Aomi uses it, so it stays on\./),
    ).toBeInTheDocument();
  });

  it("shows the notice once per device and again for a wider envelope", async () => {
    const backend = installBackend([NOT_VERIFIED]);
    await renderModal();

    fireEvent.click(rowSwitch("Hoodit trade"));
    const notice = await screen.findByRole("alertdialog");
    expect(within(notice).getByText("Talks to: api.gmgn.ai")).toBeTruthy();
    expect(
      within(notice).getByText(
        "Can ask you to: Approve transactions on EVM chains",
      ),
    ).toBeTruthy();
    fireEvent.click(within(notice).getByRole("button", { name: "Cancel" }));
    expect(backend.writes()).toEqual([]);

    fireEvent.click(rowSwitch("Hoodit trade"));
    fireEvent.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", {
        name: "Turn on",
      }),
    );
    await waitFor(() =>
      expect(rowSwitch("Hoodit trade")).toHaveAttribute("aria-checked", "true"),
    );
    expect(backend.writes()).toEqual([
      {
        method: "PUT",
        path: "/api/account/packages/9010/choice",
        body: { enabled: true },
      },
    ]);
    const readsAfterOn = backend.reads();

    // Off and on again with the same envelope: no notice.
    fireEvent.click(rowSwitch("Hoodit trade"));
    await waitFor(() =>
      expect(rowSwitch("Hoodit trade")).toHaveAttribute(
        "aria-checked",
        "false",
      ),
    );
    expect(backend.reads()).toBeGreaterThan(readsAfterOn);
    fireEvent.click(rowSwitch("Hoodit trade"));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    await waitFor(() =>
      expect(rowSwitch("Hoodit trade")).toHaveAttribute("aria-checked", "true"),
    );

    // A release with a wider envelope asks again.
    cleanup();
    backend.setRows([
      {
        ...NOT_VERIFIED,
        envelope: { ...NOT_VERIFIED.envelope, hash: "sha256:wider" },
      },
    ]);
    await renderModal();
    fireEvent.click(rowSwitch("Hoodit trade"));
    expect(await screen.findByRole("alertdialog")).toBeTruthy();
  });

  it("connects a person key from the row and explains builder keys", async () => {
    const backend = installBackend([NEEDS_KEY]);
    await renderModal();
    fireEvent.click(screen.getByRole("button", { name: "Connect Polymarket" }));
    expect(screen.getByText("Set by the builder")).toBeTruthy();
    expect(screen.queryByLabelText("POLY_BUILDER")).toBeNull();
    fireEvent.change(screen.getByLabelText("POLY_API_KEY"), {
      target: { value: " secret " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save key" }));
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "Connect Polymarket" }),
      ).toBeNull(),
    );
    expect(backend.writes()).toEqual([
      {
        method: "PUT",
        path: "/api/account/packages/9020/secrets/POLY_API_KEY",
        body: { value: "secret" },
      },
    ]);
    expect(screen.getByLabelText("Remove POLY_API_KEY")).toBeTruthy();
  });

  it("shows a refused switch in place", async () => {
    installBackend([VERIFIED]);
    await renderModal();
    vi.mocked(fetch).mockImplementationOnce(async () =>
      Response.json({ error: "agent_listed" }, { status: 409 }),
    );
    fireEvent.click(rowSwitch("Jupiter"));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Aomi uses this package, so it stays on.",
    );
    expect(rowSwitch("Jupiter")).toHaveAttribute("aria-checked", "true");
  });

  it("lets a guest browse defaults without switching", async () => {
    seedAccountOverview(null);
    const backend = installBackend([VERIFIED, NOT_VERIFIED]);
    await renderModal();
    expect(rowSwitch("Jupiter")).toBeDisabled();
    expect(backend.writes()).toEqual([]);
  });
});
