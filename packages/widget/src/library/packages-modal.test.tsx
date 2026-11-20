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
      if (url.pathname === "/api/public/catalog/packages")
        return Response.json({
          packages: rows
            .filter((row) => row.listed)
            .map((row) => ({
              id: row.id,
              display_name: row.display_name,
              description: row.description,
              icon_url: row.icon_url,
              chains: row.chains,
              tags: row.tags,
              tool_count: row.tool_count,
              skills: row.skills,
              verified: row.verified,
            })),
        });
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
      if (secret && method === "DELETE") {
        const id = Number(secret[1]);
        const row = rows.find((candidate) => candidate.package_id === id)!;
        update(id, {
          slots: row.slots.map((slot) =>
            slot.name === secret[2] ? { ...slot, status: "missing" } : slot,
          ),
        });
        return Response.json({ slot: secret[2], status: "missing" });
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

const details = (name: string) =>
  screen.getByRole("complementary", { name: `${name} details` });

/** Opens a package's detail panel and clicks its footer action. */
const actOn = (name: string, action: string) => {
  fireEvent.click(screen.getByLabelText(`Open ${name} details`));
  fireEvent.click(within(details(name)).getByRole("button", { name: action }));
};

const footerAction = async (name: string, action: string) =>
  waitFor(() =>
    expect(
      within(details(name)).getByRole("button", { name: action }),
    ).toBeTruthy(),
  );

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
    const headings = within(screen.getByRole("main"))
      .getAllByRole("heading", { level: 2 })
      .map((heading) => heading.textContent);
    expect(headings.join("|")).toMatch(/Used by Aomi.*Verified.*Not verified/);
    expect(screen.queryAllByRole("switch")).toEqual([]);
    // The first package listed is open; its row says it is on.
    expect(within(details("Aave")).getByText("Always on here")).toBeTruthy();
    expect(
      within(details("Aave")).queryByRole("button", { name: /Turn/ }),
    ).toBeNull();
    expect(
      within(screen.getByLabelText("Open Aave details")).getByText("On"),
    ).toBeTruthy();
    expect(
      within(screen.getByLabelText("Open Hoodit trade details")).queryByText(
        "On",
      ),
    ).toBeNull();
  });

  it("shows the notice once per device and again for a wider envelope", async () => {
    const backend = installBackend([NOT_VERIFIED]);
    await renderModal();
    expect(
      within(details("Hoodit trade")).getByText("Not in your chats"),
    ).toBeTruthy();

    actOn("Hoodit trade", "Turn on");
    const notice = await screen.findByRole("alertdialog");
    expect(within(notice).getByText("Talks to: api.gmgn.ai")).toBeTruthy();
    expect(within(notice).getByText("Prepares EVM transactions")).toBeTruthy();
    fireEvent.click(within(notice).getByRole("button", { name: "Cancel" }));
    expect(backend.writes()).toEqual([]);

    actOn("Hoodit trade", "Turn on");
    fireEvent.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", {
        name: "Turn on",
      }),
    );
    await footerAction("Hoodit trade", "Turn off");
    expect(
      within(details("Hoodit trade")).getByText("In your chats"),
    ).toBeTruthy();
    expect(backend.writes()).toEqual([
      {
        method: "PUT",
        path: "/api/account/packages/9010/choice",
        body: { enabled: true },
      },
    ]);
    const readsAfterOn = backend.reads();

    // Off and on again with the same envelope: no notice.
    actOn("Hoodit trade", "Turn off");
    await footerAction("Hoodit trade", "Turn on");
    expect(backend.reads()).toBeGreaterThan(readsAfterOn);
    actOn("Hoodit trade", "Turn on");
    expect(screen.queryByRole("alertdialog")).toBeNull();
    await footerAction("Hoodit trade", "Turn off");

    // A release with a wider envelope asks again.
    cleanup();
    backend.setRows([
      {
        ...NOT_VERIFIED,
        envelope: { ...NOT_VERIFIED.envelope, hash: "sha256:wider" },
      },
    ]);
    await renderModal();
    actOn("Hoodit trade", "Turn on");
    expect(await screen.findByRole("alertdialog")).toBeTruthy();
  });

  it("connects a person key from the panel in a sheet", async () => {
    const backend = installBackend([NEEDS_KEY]);
    await renderModal();
    const keys = within(details("Polymarket"));
    expect(keys.getByText("POLY_API_KEY")).toBeTruthy();
    expect(keys.getByText("Not added")).toBeTruthy();
    expect(keys.queryByText("POLY_BUILDER")).toBeNull();
    expect(keys.getByRole("button", { name: "Add keys" })).toBeTruthy();
    expect(keys.queryByRole("button", { name: "Remove keys" })).toBeNull();
    actOn("Polymarket", "Connect");
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
    await footerAction("Polymarket", "Turn off");
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
    expect(within(details("Polymarket")).getByText("Added")).toBeTruthy();

    // Remove keys clears the saved person key; Connect comes back.
    fireEvent.click(
      within(details("Polymarket")).getByRole("button", {
        name: "Remove keys",
      }),
    );
    await footerAction("Polymarket", "Connect");
    expect(backend.writes().at(-1)).toEqual({
      method: "DELETE",
      path: "/api/account/packages/9020/secrets/POLY_API_KEY",
      body: undefined,
    });
    expect(
      within(details("Polymarket")).queryByRole("button", {
        name: "Remove keys",
      }),
    ).toBeNull();
  });

  it("closes a sheet with Escape and keeps the Library open", async () => {
    installBackend([VERIFIED]);
    const onClose = vi.fn();
    render(<PackagesModal onClose={onClose} />, {
      wrapper: AccountOverviewFixture,
    });
    fireEvent.click(await screen.findByRole("button", { name: "Add custom" }));
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
      within(screen.getByRole("main"))
        .getAllByRole("heading", { level: 2 })
        .map((h) => h.textContent),
    ).toEqual(["To connect"]);
    expect(screen.getAllByRole("article")).toHaveLength(1);
  });

  it("opens the first package listed, then the one clicked", async () => {
    installBackend([NOT_VERIFIED, VERIFIED]);
    await renderModal();
    expect(details("Jupiter")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Open Hoodit trade details"));
    expect(details("Hoodit trade")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Open Hoodit trade details"));
    expect(details("Hoodit trade")).toBeTruthy();
    // A search starts again from its first result.
    fireEvent.change(screen.getByLabelText("Search library"), {
      target: { value: "solana" },
    });
    expect(details("Jupiter")).toBeTruthy();
  });

  it("shows the resolved chains in the detail and filters by network and tag, rows without a VM pill", async () => {
    installBackend([NOT_VERIFIED, VERIFIED, AGENT_LISTED, NEEDS_KEY]);
    await renderModal();
    fireEvent.click(screen.getByLabelText("Open Aave details"));
    const chains = within(details("Aave"))
      .getByRole("heading", { name: /^Chains/ })
      .closest("section")!;
    expect(
      within(chains)
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual(["Ethereum", "Base", "Arbitrum"]);
    for (const row of screen.getAllByRole("article")) {
      expect(
        within(row).queryByText(/^(EVM|Solana|Ethereum|Base)$/),
      ).toBeNull();
    }

    const shown = () =>
      screen
        .getAllByRole("article")
        .map((row) => within(row).getAllByText(/./)[0]!.textContent);
    const networks = screen.getByRole("navigation", {
      name: "Library networks",
    });
    expect(
      within(networks)
        .getAllByRole("button")
        .map((item) => item.textContent),
    ).toEqual([
      "Ethereum1",
      "Base1",
      "Arbitrum1",
      "Polygon1",
      "Robinhood Chain1",
      "Solana1",
    ]);
    fireEvent.click(within(networks).getByRole("button", { name: /Solana/ }));
    expect(shown()).toEqual(["Jupiter"]);
    fireEvent.click(within(networks).getByRole("button", { name: /Solana/ }));
    expect(screen.getAllByRole("article")).toHaveLength(4);

    const tags = screen.getByRole("navigation", { name: "Library tags" });
    expect(
      within(tags)
        .getAllByRole("button")
        .map((item) => item.textContent),
    ).toEqual(["Lending1", "DEX1", "Prediction1"]);
    fireEvent.click(within(tags).getByRole("button", { name: /Prediction/ }));
    expect(shown()).toEqual(["Polymarket"]);
  });

  it("lists every package, with no Show more", async () => {
    installBackend(
      Array.from({ length: 7 }, (_, index) => ({
        ...VERIFIED,
        package_id: 9300 + index,
        id: `aomi/pkg-${index}`,
        display_name: `Package ${index}`,
      })),
    );
    await renderModal();
    expect(screen.getAllByRole("article")).toHaveLength(7);
    expect(screen.queryByRole("button", { name: /more/ })).toBeNull();
  });

  it("shows the panel sections the account row has data for", async () => {
    installBackend([
      {
        ...VERIFIED,
        tool_count: 2,
        tools: [
          { name: "quote", description: "Read a swap quote." },
          { name: "prepare", description: "Prepare a swap." },
        ],
        guards: ["svm/jupiter"],
        live: { release: 4, digest: "sha256:7c21deadbeef9a" },
        slots: [
          {
            name: "JUPITER_API_KEY",
            owner: "builder",
            description: "",
            required: false,
            status: "ready",
          },
        ],
      },
      {
        ...AGENT_LISTED,
        tool_count: 0,
        envelope: { ...AGENT_LISTED.envelope, transactions: [], hosts: [] },
      },
    ]);
    await renderModal();
    fireEvent.click(screen.getByLabelText("Open Jupiter details"));
    const panel = within(details("Jupiter"));
    expect(
      panel.getAllByRole("heading", { level: 3 }).map((h) => h.textContent),
    ).toEqual(["Chains", "Wallet", "Instructions", "Tools2", "Connects to"]);
    expect(panel.getByText("Solana")).toBeTruthy();
    expect(panel.getByText("Prepares Solana transactions")).toBeTruthy();
    expect(panel.getByText("svm/jupiter")).toBeTruthy();
    expect(panel.getByText("api.jup.ag")).toBeTruthy();
    expect(panel.getByText("The publisher provides the API key.")).toBeTruthy();
    expect(panel.getByText(/Release 4/)).toHaveTextContent(
      "Release 4 · 7c21…9a",
    );
    expect(panel.queryByText("quote")).toBeNull();
    fireEvent.click(panel.getByRole("button", { name: /Tools/ }));
    expect(panel.getByText("quote")).toBeTruthy();
    expect(panel.getByText("Prepare a swap.")).toBeTruthy();

    fireEvent.click(screen.getByLabelText("Open Aave details"));
    const aave = within(details("Aave"));
    expect(
      aave.getByText("Never asks for a transaction or a signature."),
    ).toBeTruthy();
    expect(aave.queryByText("Tools")).toBeNull();
    expect(aave.queryByText("Connects to")).toBeNull();
  });

  it("host_row_has_no_release_line", async () => {
    installBackend([
      {
        ...VERIFIED,
        id: "aomi/scheduling",
        display_name: "Scheduling",
        live: { release: null, digest: "sha256:1a2b3c4d5e6f" },
        envelope: { hash: null, hosts: [], transactions: [], signatures: [] },
        slots: [],
        guards: [],
      },
    ]);
    await renderModal();
    fireEvent.click(screen.getByLabelText("Open Scheduling details"));
    const panel = within(details("Scheduling"));
    expect(panel.queryByText(/Release/)).toBeNull();
    expect(panel.queryByText(/1a2b/)).toBeNull();
  });

  it("asks before a not verified package only, and calls optional keys optional", async () => {
    const binance: AomiPackage = {
      ...NOT_VERIFIED,
      slots: [
        {
          name: "BINANCE_API_KEY",
          owner: "person",
          description: "",
          required: false,
          status: "missing",
        },
      ],
    };
    const backend = installBackend([
      { ...VERIFIED, enabled: false, choice: false, reason: "chosen_off" },
      binance,
    ]);
    await renderModal();
    actOn("Jupiter", "Turn on");
    expect(screen.queryByRole("alertdialog")).toBeNull();
    await waitFor(() => expect(backend.writes()).toHaveLength(1));

    // An optional key does not stand in the way of Turn on.
    actOn("Hoodit trade", "Turn on");
    const notice = await screen.findByRole("alertdialog");
    expect(
      within(notice).getByText("Add your own key: BINANCE_API_KEY · optional"),
    ).toBeTruthy();
    expect(within(notice).queryByText(/Needs your key/)).toBeNull();
  });

  it("shows a refused change in place", async () => {
    installBackend([VERIFIED]);
    await renderModal();
    vi.mocked(fetch).mockImplementationOnce(async () =>
      Response.json({ error: "agent_listed" }, { status: 409 }),
    );
    actOn("Jupiter", "Turn off");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Aomi uses this package, so it stays on.",
    );
    await footerAction("Jupiter", "Turn off");
  });

  it("shows a guest the public catalog, read only", async () => {
    seedAccountOverview(null);
    const backend = installBackend([VERIFIED, NOT_VERIFIED, PRIVATE]);
    await renderModal();
    expect(screen.getByLabelText("Open Jupiter details")).toBeTruthy();
    expect(screen.getByLabelText("Open Hoodit trade details")).toBeTruthy();
    expect(screen.queryByLabelText("Open Secret Tool details")).toBeNull();
    expect(
      within(screen.getByRole("main"))
        .getAllByRole("heading", { level: 2 })
        .map((heading) => heading.textContent),
    ).toEqual(["Verified", "Not verified"]);
    const nav = screen.getByRole("navigation", { name: "Library sections" });
    expect(
      within(nav)
        .getAllByRole("button")
        .map((item) => item.textContent),
    ).toEqual(["All packages2", "Verified1", "Not verified1"]);
    expect(screen.queryByRole("button", { name: "Add custom" })).toBeNull();
    expect(screen.queryByText("On")).toBeNull();

    const panel = within(details("Jupiter"));
    expect(panel.getByText("Instructions")).toBeTruthy();
    expect(panel.getByText("Solana")).toBeTruthy();
    expect(panel.getByText("Tools")).toBeTruthy();
    expect(panel.queryByText("Wallet")).toBeNull();
    expect(panel.queryByText("Connects to")).toBeNull();
    expect(panel.queryByText(/Release/)).toBeNull();
    expect(panel.getByText("Sign in to turn it on")).toBeTruthy();
    fireEvent.click(panel.getByRole("button", { name: "Sign in" }));
    expect(host.connect).toHaveBeenCalledOnce();
    expect(backend.calls.map((call) => call.path)).toEqual([
      "/api/public/catalog/packages",
    ]);
  });

  it("adds a private package with a code and opens its detail", async () => {
    const backend = installBackend([VERIFIED]);
    await renderModal();
    fireEvent.click(screen.getByRole("button", { name: "Add custom" }));
    fireEvent.change(screen.getByLabelText("Activation code"), {
      target: { value: "good-code" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(
      await screen.findByRole("button", { name: "Open Secret Tool details" }),
    ).toBeTruthy();
    expect(details("Secret Tool")).toBeTruthy();
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
    fireEvent.click(screen.getByRole("button", { name: "Add custom" }));
    fireEvent.change(screen.getByLabelText("Activation code"), {
      target: { value: "nope" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "That code isn’t valid",
    );
    expect(screen.getByLabelText("Activation code")).toBeTruthy();
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

  it("offers a guest Retry when the public read fails", async () => {
    seedAccountOverview(null);
    const backend = installBackend([VERIFIED]);
    vi.mocked(fetch).mockImplementationOnce(
      async () => new Response("down", { status: 503 }),
    );
    await renderModal();
    expect(screen.getByText("Couldn’t load your Library")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(
      await screen.findByRole("button", { name: "Open Jupiter details" }),
    ).toBeTruthy();
    expect(
      backend.calls.every((call) => call.path.startsWith("/api/public/")),
    ).toBe(true);
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
