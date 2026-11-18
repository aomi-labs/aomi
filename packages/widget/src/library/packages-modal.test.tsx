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

const host = vi.hoisted(() => ({
  runtime: undefined as
    | { currentThreadId: string; isRemoteThread: (id: string) => boolean }
    | undefined,
  connect: vi.fn(),
}));
vi.mock("@aomi-labs/react", async (original) => ({
  ...(await original<typeof import("@aomi-labs/react")>()),
  useOptionalAomiRuntime: () => host.runtime,
}));
vi.mock("@/wallet/context", async (original) => {
  const actual = await original<typeof import("@/wallet/context")>();
  return {
    ...actual,
    useAomiWalletKit: () => ({
      ...actual.useAomiWalletKit(),
      connect: host.connect,
    }),
  };
});

const PRIVATE: AomiPackage = {
  ...NOT_VERIFIED,
  package_id: 9100,
  id: "acme/secret-tool",
  display_name: "Secret Tool",
  listed: false,
};

type Call = { method: string; path: string; body: unknown };

/** The Library backend: rows change as the person switches and connects. */
function installBackend(initial: AomiPackage[]) {
  let rows = initial.map((row) => ({ ...row }));
  const calls: Call[] = [];
  const listQueries: string[] = [];
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
      if (url.pathname === "/api/account/packages") {
        listQueries.push(url.search);
        return Response.json(catalog(rows));
      }
      if (url.pathname === "/api/account/packages/activate") {
        if ((body as { code: string }).code !== "good-code")
          return Response.json({ error: "code_invalid" }, { status: 404 });
        rows = [...rows, PRIVATE];
        return Response.json(PRIVATE);
      }
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
    listQueries,
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
    host.runtime = undefined;
    host.connect.mockReset();
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

  it("connects a person key from the row in a sheet", async () => {
    const backend = installBackend([NEEDS_KEY]);
    await renderModal();
    fireEvent.click(screen.getByRole("button", { name: "Connect Polymarket" }));
    const sheet = await screen.findByRole("dialog", {
      name: "Connect Polymarket",
    });
    expect(within(sheet).queryByLabelText("POLY_BUILDER")).toBeNull();
    const connect = within(sheet).getByRole("button", { name: "Connect" });
    expect(connect).toBeDisabled();
    fireEvent.change(within(sheet).getByLabelText("POLY_API_KEY"), {
      target: { value: " secret " },
    });
    fireEvent.click(connect);
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "Connect Polymarket" }),
      ).toBeNull(),
    );
    expect(
      screen.queryByRole("dialog", { name: "Connect Polymarket" }),
    ).toBeNull();
    expect(backend.writes()).toEqual([
      {
        method: "PUT",
        path: "/api/account/packages/9020/secrets/POLY_API_KEY",
        body: { value: "secret" },
      },
    ]);
    const details = screen.getByRole("complementary", {
      name: "Polymarket details",
    });
    expect(within(details).getByText("Connected")).toBeTruthy();
    expect(
      within(details).getByRole("button", { name: "Replace key" }),
    ).toBeTruthy();
  });

  it("closes a sheet with Escape and keeps the Library open", async () => {
    installBackend([VERIFIED]);
    const onClose = vi.fn();
    render(<PackagesModal onClose={onClose} />, {
      wrapper: AccountOverviewFixture,
    });
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Add a private package with a code",
      }),
    );
    const sheet = await screen.findByRole("dialog", {
      name: "Add a private package",
    });
    fireEvent.keyDown(sheet, { key: "Escape" });
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Add a private package" }),
      ).toBeNull(),
    );
    expect(onClose).not.toHaveBeenCalled();
  });

  it("lists the packages to connect as one group", async () => {
    installBackend([NEEDS_KEY, VERIFIED]);
    await renderModal();
    fireEvent.click(screen.getByRole("button", { name: /^To connect/ }));
    expect(
      screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent),
    ).toEqual(["To connect"]);
    expect(screen.getAllByRole("article")).toHaveLength(1);
  });

  it("opens the inspector only for a selected package", async () => {
    installBackend([VERIFIED]);
    await renderModal();
    const details = () =>
      screen.queryByRole("complementary", { name: "Jupiter details" });
    expect(details()).toBeNull();
    fireEvent.click(screen.getByLabelText("Open Jupiter details"));
    expect(details()).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Open Jupiter details"));
    expect(details()).toBeNull();
  });

  it("shows five rows per group, then the rest on request", async () => {
    installBackend(
      Array.from({ length: 7 }, (_, index) => ({
        ...VERIFIED,
        package_id: 9300 + index,
        id: `aomi/pkg-${index}`,
        display_name: `Package ${index}`,
      })),
    );
    await renderModal();
    expect(screen.getAllByRole("article")).toHaveLength(5);
    fireEvent.click(screen.getByRole("button", { name: "Show 2 more" }));
    expect(screen.getAllByRole("article")).toHaveLength(7);
  });

  it("switches a not verified package on from the inspector after its notice", async () => {
    const backend = installBackend([NOT_VERIFIED]);
    await renderModal();
    fireEvent.click(screen.getByLabelText("Open Hoodit trade details"));
    const details = screen.getByRole("complementary", {
      name: "Hoodit trade details",
    });
    expect(
      within(details).getByText(
        "Not verified by Aomi. It can reach api.gmgn.ai and can ask you to approve transactions.",
      ),
    ).toBeTruthy();
    fireEvent.click(within(details).getByRole("switch"));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    await waitFor(() =>
      expect(backend.writes()).toEqual([
        {
          method: "PUT",
          path: "/api/account/packages/9010/choice",
          body: { enabled: true },
        },
      ]),
    );
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

  it("adds a private package with a code and opens its detail", async () => {
    const backend = installBackend([VERIFIED]);
    await renderModal();
    fireEvent.click(
      screen.getByRole("button", { name: "Add a private package with a code" }),
    );
    fireEvent.change(screen.getByLabelText("Activation code"), {
      target: { value: "good-code" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(
      await screen.findByRole("button", { name: "Open Secret Tool details" }),
    ).toBeTruthy();
    expect(backend.writes()).toEqual([
      {
        method: "POST",
        path: "/api/account/packages/activate",
        body: { code: "good-code" },
      },
    ]);
    expect(screen.queryByLabelText("Activation code")).toBeNull();
    expect(JSON.stringify({ ...localStorage })).not.toContain("good-code");
    expect(JSON.stringify({ ...sessionStorage })).not.toContain("good-code");
  });

  it("shows an invalid code in place", async () => {
    installBackend([VERIFIED]);
    await renderModal();
    fireEvent.click(
      screen.getByRole("button", { name: "Add a private package with a code" }),
    );
    fireEvent.change(screen.getByLabelText("Activation code"), {
      target: { value: "nope" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "That code isn’t valid",
    );
    expect(screen.getByLabelText("Activation code")).toBeTruthy();
  });

  it("asks a guest to sign in instead of offering a code field", async () => {
    seedAccountOverview(null);
    installBackend([VERIFIED]);
    await renderModal();
    expect(screen.getByText("Sign in to add a private package")).toBeTruthy();
    expect(
      screen.queryByRole("button", {
        name: "Add a private package with a code",
      }),
    ).toBeNull();
  });

  it("reads the open chat's agent only once the server stores that chat", async () => {
    const backend = installBackend([VERIFIED]);
    host.runtime = {
      currentThreadId: "draft-chat",
      isRemoteThread: () => false,
    };
    await renderModal();
    expect(screen.getByRole("button", { name: "Open Jupiter details" }));
    cleanup();
    host.runtime = {
      currentThreadId: "saved-chat",
      isRemoteThread: (id) => id === "saved-chat",
    };
    await renderModal();
    expect(backend.listQueries).toEqual(["", "?thread_id=saved-chat"]);
  });

  it("asks a signed-out visitor to sign in instead of showing the error", async () => {
    seedAccountOverview(null);
    installBackend([]);
    vi.mocked(fetch).mockImplementation(async () =>
      Response.json({ error: "unauthenticated" }, { status: 401 }),
    );
    await renderModal();
    expect(screen.getByText("Sign in to see your Library")).toBeTruthy();
    expect(screen.queryByText(/unauthenticated/)).toBeNull();
    expect(screen.queryByText("Sign in to add a private package")).toBeNull();
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
    expect(
      within(
        screen.getByRole("navigation", { name: "Library sections" }),
      ).queryAllByText("0"),
    ).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(host.connect).toHaveBeenCalledOnce();
  });

  it("asks to sign in again when the session has ended", async () => {
    installBackend([]);
    vi.mocked(fetch).mockImplementation(async () =>
      Response.json({ error: "unauthenticated" }, { status: 401 }),
    );
    await renderModal();
    expect(screen.getByText("Your session ended")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Sign in again" }));
    expect(host.connect).toHaveBeenCalledOnce();
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  });

  it("offers Retry only for a real failure, without the error code", async () => {
    const backend = installBackend([VERIFIED]);
    vi.mocked(fetch).mockImplementationOnce(async () =>
      Response.json({ error: "session_not_found" }, { status: 404 }),
    );
    await renderModal();
    expect(screen.getByText("Couldn’t load your Library")).toBeTruthy();
    expect(screen.queryByText(/session_not_found/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(
      await screen.findByRole("button", { name: "Open Jupiter details" }),
    ).toBeTruthy();
    expect(backend.reads()).toBe(1);
  });
});
