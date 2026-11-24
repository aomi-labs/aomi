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
import { useAomiDisplayCache } from "@aomi-labs/react";
import { usePackagePickerItems } from "@/composer/capability-composer/catalog";
import { onCapabilityMentionRequest } from "@/composer/capability-composer/model";
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
  removable: true,
};

/** What the backend answers for a verified package's code. */
const PRIVATE_ON: AomiPackage = {
  ...PRIVATE,
  verified: true,
  enabled: true,
  choice: true,
  reason: "chosen_on",
};

type Call = { method: string; path: string; body: unknown };

/** The Library backend: rows change as the person switches and connects. */
function installBackend(
  initial: AomiPackage[],
  privateRow: AomiPackage = PRIVATE,
) {
  let rows = initial.map((row) => ({ ...row }));
  let account = "acct-1";
  const calls: Call[] = [];
  const listQueries: string[] = [];
  const choiceQueries: string[] = [];
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
      if (url.pathname === "/api/account")
        return Response.json({ user: { user_id: account } });
      if (url.pathname === "/api/account/packages") {
        listQueries.push(url.search);
        return Response.json(catalog(rows));
      }
      if (url.pathname === "/api/account/packages/activate") {
        if ((body as { code: string }).code !== "good-code")
          return Response.json({ error: "code_invalid" }, { status: 404 });
        const added = { ...privateRow };
        rows = [...rows, added];
        return Response.json(added);
      }
      const own = url.pathname.match(/^\/api\/account\/packages\/(\d+)$/);
      if (own && method === "DELETE") {
        rows = rows.filter((row) => row.package_id !== Number(own[1]));
        return Response.json({ removed: true });
      }
      const choice = url.pathname.match(
        /^\/api\/account\/packages\/(\d+)\/choice$/,
      );
      if (choice && method === "PUT") {
        choiceQueries.push(url.search);
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
    choiceQueries,
    writes: () => calls.filter((call) => call.method !== "GET"),
    reads: () =>
      calls.filter((call) => call.path === "/api/account/packages").length,
    setRows: (next: AomiPackage[]) => {
      rows = next;
    },
    /** Who this browser's requests are signed in as. */
    signIn: (id: string) => {
      account = id;
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

const rowOf = (name: string) =>
  within(screen.getByLabelText(`Open ${name} details`).closest("article")!);

const addWithCode = (code: string) => {
  fireEvent.click(screen.getByRole("button", { name: "Add with code" }));
  fireEvent.change(screen.getByLabelText("Activation code"), {
    target: { value: code },
  });
  fireEvent.click(screen.getByRole("button", { name: "Add" }));
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
    // The first package listed is open and locked on.
    const aave = within(details("Aave"));
    expect(aave.getByText("Always on")).toBeTruthy();
    expect(aave.getByRole("button", { name: "Use in chat" })).toBeTruthy();
    expect(aave.queryByRole("button", { name: /Turn|Remove/ })).toBeNull();
  });

  it("offers each state's action on the row, beside its details", async () => {
    const backend = installBackend([
      AGENT_LISTED,
      VERIFIED,
      { ...NOT_VERIFIED, verified: true },
      NEEDS_KEY,
      {
        ...VERIFIED,
        package_id: 1,
        id: "aomi/scheduling",
        display_name: "Scheduling",
        available: false,
        enabled: false,
      },
    ]);
    await renderModal();
    const actions = (name: string) =>
      rowOf(name)
        .getAllByRole("button")
        .map((button) => button.getAttribute("aria-label"));
    expect(actions("Aave")).toEqual(["Open Aave details", "Use in chat: Aave"]);
    expect(actions("Jupiter")).toEqual([
      "Open Jupiter details",
      "Use in chat: Jupiter",
    ]);
    expect(actions("Hoodit trade")).toEqual([
      "Open Hoodit trade details",
      "Turn on Hoodit trade",
    ]);
    expect(actions("Polymarket")).toEqual([
      "Open Polymarket details",
      "Connect Polymarket",
    ]);
    expect(actions("Scheduling")).toEqual(["Open Scheduling details"]);
    expect(rowOf("Scheduling").getByText("Not in this agent")).toBeTruthy();
    expect(screen.queryByText("On", { selector: "article *" })).toBeNull();

    // A row's action works without opening its details.
    fireEvent.click(
      rowOf("Hoodit trade").getByRole("button", { name: /^Turn on/ }),
    );
    expect(
      await rowOf("Hoodit trade").findByRole("button", {
        name: /^Use in chat/,
      }),
    ).toBeTruthy();
    expect(details("Aave")).toBeTruthy();
    expect(backend.writes()).toHaveLength(1);
    fireEvent.click(
      rowOf("Polymarket").getByRole("button", { name: /^Connect/ }),
    );
    expect(
      await screen.findByRole("dialog", { name: "Connect Polymarket" }),
    ).toBeTruthy();
  });

  it("uses a package in the chat behind it: closes and asks that frame's composer for the tag", async () => {
    installBackend([VERIFIED]);
    const onClose = vi.fn();
    const asked = vi.fn();
    const another = vi.fn();
    const onWindow = vi.spyOn(window, "dispatchEvent");
    onCapabilityMentionRequest({}, another);
    let frame: object | undefined;
    function Frame() {
      frame = useAomiDisplayCache()?.client;
      return <PackagesModal onClose={onClose} />;
    }
    render(<Frame />, { wrapper: AccountOverviewFixture });
    await screen.findByLabelText("Open Jupiter details");
    const stop = onCapabilityMentionRequest(frame!, asked);
    onWindow.mockClear();
    fireEvent.click(
      rowOf("Jupiter").getByRole("button", { name: /^Use in chat/ }),
    );
    expect(onClose).toHaveBeenCalledOnce();
    actOn("Jupiter", "Use in chat");
    stop();
    expect(asked.mock.calls).toEqual(
      Array(2).fill([{ kind: "package", id: "aomi/jupiter" }]),
    );
    expect(another).not.toHaveBeenCalled();
    expect(onWindow).not.toHaveBeenCalled();
  });

  it("removes a package added with a code, after a confirm", async () => {
    const backend = installBackend([VERIFIED, PRIVATE_ON]);
    await renderModal();
    expect(
      within(details("Secret Tool")).getByRole("button", { name: "Turn off" }),
    ).toBeTruthy();
    actOn("Secret Tool", "Remove");
    const confirm = within(await screen.findByRole("alertdialog"));
    expect(confirm.getByText("Remove Secret Tool?")).toBeTruthy();
    expect(
      confirm.getByText(
        "It leaves your Library and your saved keys for it are permanently deleted. To add it again you need a valid code from the publisher.",
      ),
    ).toBeTruthy();
    fireEvent.click(confirm.getByRole("button", { name: "Cancel" }));
    expect(backend.writes()).toEqual([]);

    actOn("Secret Tool", "Remove");
    fireEvent.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", {
        name: "Remove",
      }),
    );
    await waitFor(() =>
      expect(screen.queryByLabelText("Open Secret Tool details")).toBeNull(),
    );
    expect(backend.writes()).toEqual([
      { method: "DELETE", path: "/api/account/packages/9100", body: undefined },
    ]);
    expect(
      within(details("Jupiter")).queryByRole("button", { name: "Remove" }),
    ).toBeNull();
  });

  it('offers a change in "@" at once, in the open chat and in the next one', async () => {
    installBackend([
      { ...VERIFIED, enabled: false, choice: false, reason: "chosen_off" },
      PRIVATE_ON,
    ]);
    host.runtime = { currentThreadId: "new", isRemoteThread: () => false };
    const offered = () => screen.getByTestId("offered").textContent;
    function At() {
      return (
        <p data-testid="offered">
          {usePackagePickerItems()
            .map((item) => item.label)
            .join(", ")}
        </p>
      );
    }
    const chat = () => (
      <>
        <At />
        <PackagesModal onClose={() => undefined} />
      </>
    );
    const view = render(chat(), { wrapper: AccountOverviewFixture });
    await waitFor(() => expect(offered()).toBe("Secret Tool"));

    // On with a new chat open.
    actOn("Jupiter", "Turn on");
    await waitFor(() => expect(offered()).toContain("Jupiter"));

    // Off and removed in a saved chat: the new chat read its rows before that.
    host.runtime = { currentThreadId: "saved", isRemoteThread: () => true };
    view.rerender(chat());
    await waitFor(() => expect(offered()).toContain("Jupiter"));
    await footerAction("Jupiter", "Turn off");
    actOn("Jupiter", "Turn off");
    await waitFor(() => expect(offered()).toBe("Secret Tool"));
    actOn("Secret Tool", "Remove");
    fireEvent.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", {
        name: "Remove",
      }),
    );
    await waitFor(() => expect(offered()).toBe(""));
    host.runtime = { currentThreadId: "new", isRemoteThread: () => false };
    view.rerender(chat());
    await waitFor(() => expect(offered()).toBe(""));
  });

  it("shows the notice once per device and again for a wider envelope", async () => {
    const backend = installBackend([NOT_VERIFIED]);
    await renderModal();
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

  it("asks about a package that declares nothing without promising anything", async () => {
    installBackend([
      {
        ...NOT_VERIFIED,
        prepares: [],
        envelope: { ...NOT_VERIFIED.envelope, hosts: [], signatures: [] },
      },
    ]);
    await renderModal();
    actOn("Hoodit trade", "Turn on");
    const notice = within(await screen.findByRole("alertdialog"));
    expect(notice.getByText("Not verified")).toBeTruthy();
    expect(notice.queryByRole("list")).toBeNull();
    expect(notice.queryByText(/asks for no|no outside/)).toBeNull();
  });

  describe("when the account changes", () => {
    const become = (id: string | null) =>
      act(async () =>
        seedAccountOverview(id ? { user: { user_id: id } } : null),
      );
    const KEYED = { ...NEEDS_KEY, enabled: true };
    const twoKeys = {
      ...KEYED,
      slots: ["POLY_API_KEY", "POLY_SECRET"].map((name) => ({
        ...NEEDS_KEY.slots[0]!,
        name,
        owner: "person" as const,
      })),
    };
    /** Holds the write to `path` until released. */
    const hold = (path: string) => {
      const answer = vi.mocked(fetch).getMockImplementation()!;
      let release!: () => void;
      const held = new Promise<void>((resolve) => (release = resolve));
      vi.mocked(fetch).mockImplementation(async (input, init) => {
        if (init?.method && init.method !== "GET" && `${input}`.endsWith(path))
          await held;
        return answer(input, init);
      });
      return () => act(async () => release());
    };

    it.each(["acct-2", null])(
      "closes what the first account opened (next: %s)",
      async (next) => {
        const backend = installBackend([PRIVATE_ON, KEYED, NOT_VERIFIED]);
        await renderModal();
        const opened: [() => void, string][] = [
          [() => actOn("Secret Tool", "Remove"), "alertdialog"],
          [() => actOn("Hoodit trade", "Turn on"), "alertdialog"],
          [() => actOn("Polymarket", "Connect"), "dialog"],
          [
            () =>
              fireEvent.click(
                screen.getByRole("button", { name: "Add with code" }),
              ),
            "dialog",
          ],
        ];
        const open = (role: string) => screen.queryAllByRole(role).length;
        for (const [act_, role] of opened) {
          const before = open(role);
          act_();
          await waitFor(() => expect(open(role)).toBe(before + 1));
          await become(next);
          await waitFor(() => expect(open(role)).toBe(before));
          await become("acct-1");
          await screen.findByLabelText("Open Secret Tool details");
          expect(open(role)).toBe(before);
        }
        expect(backend.writes()).toEqual([]);
      },
    );

    it("stops a multi-key save between its keys", async () => {
      const backend = installBackend([twoKeys]);
      await renderModal();
      actOn("Polymarket", "Connect");
      const sheet = within(
        await screen.findByRole("dialog", { name: "Connect Polymarket" }),
      );
      for (const name of ["POLY_API_KEY", "POLY_SECRET"])
        fireEvent.change(sheet.getByLabelText(name), {
          target: { value: "mine" },
        });
      const release = hold("/secrets/POLY_API_KEY");
      fireEvent.click(sheet.getByRole("button", { name: "Connect" }));
      await waitFor(() =>
        expect(
          vi
            .mocked(fetch)
            .mock.calls.some(([url]) => `${url}`.endsWith("POLY_API_KEY")),
        ).toBe(true),
      );
      backend.signIn("acct-2");
      await become("acct-2");
      await release();
      await screen.findByLabelText("Open Polymarket details");
      expect(backend.writes().map((call) => call.path)).toEqual([
        "/api/account/packages/9020/secrets/POLY_API_KEY",
      ]);
      expect(screen.queryByRole("alert")).toBeNull();
    });

    it("shows and turns on nothing from an Add the first account started", async () => {
      const backend = installBackend([VERIFIED]);
      await renderModal();
      const release = hold("/activate");
      addWithCode("good-code");
      await waitFor(() =>
        expect(
          vi
            .mocked(fetch)
            .mock.calls.some(([url]) => `${url}`.endsWith("/activate")),
        ).toBe(true),
      );
      backend.signIn("acct-2");
      await become("acct-2");
      await release();
      await screen.findByLabelText("Open Jupiter details");
      expect(screen.queryByRole("alertdialog")).toBeNull();
      expect(backend.writes()).toHaveLength(1);
    });

    it.each([
      [
        "Remove",
        async () => {
          actOn("Secret Tool", "Remove");
          fireEvent.click(
            within(await screen.findByRole("alertdialog")).getByRole("button", {
              name: "Remove",
            }),
          );
        },
      ],
      ["Turn off", async () => actOn("Secret Tool", "Turn off")],
      ["Add", async () => addWithCode("good-code")],
    ])(
      "sends no %s once another tab signed in as someone else",
      async (_name, start) => {
        const backend = installBackend([PRIVATE_ON]);
        await renderModal();
        backend.signIn("acct-2");
        await start();
        expect(await screen.findByRole("alert")).toHaveTextContent(
          "You’re signed in to another account now, so nothing more was changed.",
        );
        expect(backend.writes()).toEqual([]);
      },
    );

    it("shows the next account the notice the first one acknowledged", async () => {
      installBackend([NOT_VERIFIED]);
      const backend = installBackend([NOT_VERIFIED]);
      await renderModal();
      actOn("Hoodit trade", "Turn on");
      fireEvent.click(
        within(await screen.findByRole("alertdialog")).getByRole("button", {
          name: "Turn on",
        }),
      );
      await footerAction("Hoodit trade", "Turn off");
      backend.signIn("acct-2");
      backend.setRows([NOT_VERIFIED]);
      await become("acct-2");
      await footerAction("Hoodit trade", "Turn on");
      actOn("Hoodit trade", "Turn on");
      expect(await screen.findByRole("alertdialog")).toBeTruthy();
    });
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
    fireEvent.click(
      await screen.findByRole("button", { name: "Add with code" }),
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
        checked: { actions: ["route", "swap"], contracts: 2 },
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
        prepares: [],
        envelope: { ...AGENT_LISTED.envelope, hosts: [] },
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
    expect(panel.getByText("Checked before signing")).toBeTruthy();
    expect(
      panel.getByText(/^Route and swap, on 2 programs in total\./),
    ).toBeTruthy();
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
    // Declaring nothing promises nothing.
    expect(aave.queryByText("Wallet")).toBeNull();
    expect(aave.queryByText("Tools")).toBeNull();
    expect(aave.queryByText("Connects to")).toBeNull();
  });

  it("host_row_has_no_release_line_and_claims_nothing_about_the_wallet", async () => {
    installBackend([
      {
        ...VERIFIED,
        id: "aomi/scheduling",
        display_name: "Scheduling",
        live: { release: null, digest: "sha256:1a2b3c4d5e6f" },
        envelope: { hash: null, hosts: [], transactions: [], signatures: [] },
        slots: [],
      },
    ]);
    await renderModal();
    fireEvent.click(screen.getByLabelText("Open Scheduling details"));
    const panel = within(details("Scheduling"));
    expect(panel.queryByText(/Release/)).toBeNull();
    expect(panel.queryByText(/1a2b/)).toBeNull();
    expect(panel.queryByText(/^Never/)).toBeNull();
  });

  it("unavailable_host_row_has_no_turn_on", async () => {
    installBackend([
      {
        ...VERIFIED,
        id: "aomi/scheduling",
        display_name: "Scheduling",
        available: false,
        enabled: false,
        reason: "off_by_default",
        live: { release: null, digest: "sha256:1a2b3c4d5e6f" },
        envelope: { hash: null, hosts: [], transactions: [], signatures: [] },
      },
    ]);
    await renderModal();
    fireEvent.click(screen.getByLabelText("Open Scheduling details"));
    const panel = within(details("Scheduling"));
    expect(panel.getByText("Not in this agent")).toBeTruthy();
    expect(panel.queryByRole("button", { name: /Turn/ })).toBeNull();
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
    await footerAction("Jupiter", "Turn off");

    // An optional key does not stand in the way of Turn on.
    actOn("Hoodit trade", "Turn on");
    const notice = await screen.findByRole("alertdialog");
    expect(
      within(notice).getByText("Add your own key: BINANCE_API_KEY · optional"),
    ).toBeTruthy();
    expect(within(notice).queryByText(/Needs your key/)).toBeNull();
  });

  it("shows a refused change in place", async () => {
    const backend = installBackend([VERIFIED]);
    await renderModal();
    backend.setRows([{ ...VERIFIED, agent_listed: true }]);
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
    expect(screen.queryByRole("button", { name: "Add with code" })).toBeNull();
    for (const row of screen.getAllByRole("article"))
      expect(within(row).getAllByRole("button")).toHaveLength(1);

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

  it("adds a private package with a code and opens its detail, on", async () => {
    const backend = installBackend([VERIFIED], PRIVATE_ON);
    await renderModal();
    addWithCode("good-code");
    expect(
      await screen.findByRole("button", { name: "Open Secret Tool details" }),
    ).toBeTruthy();
    const panel = within(details("Secret Tool"));
    expect(panel.getByRole("status")).toHaveTextContent("Added and on");
    expect(panel.getByRole("button", { name: "Use in chat" })).toBeTruthy();
    expect(screen.queryByRole("alertdialog")).toBeNull();
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

  it("asks about a not verified package it added, then turns it on", async () => {
    const backend = installBackend([VERIFIED]);
    await renderModal();
    addWithCode("good-code");
    const notice = within(await screen.findByRole("alertdialog"));
    expect(notice.getByText("Turn on Secret Tool?")).toBeTruthy();
    fireEvent.click(notice.getByRole("button", { name: "Turn on" }));
    await footerAction("Secret Tool", "Use in chat");
    expect(
      within(details("Secret Tool")).getByRole("status"),
    ).toHaveTextContent("Added and on");
    expect(backend.writes().map((call) => call.path)).toEqual([
      "/api/account/packages/activate",
      "/api/account/packages/9100/choice",
    ]);
    // Off again: the note goes with it.
    actOn("Secret Tool", "Turn off");
    await footerAction("Secret Tool", "Turn on");
    expect(within(details("Secret Tool")).queryByRole("status")).toBeNull();
  });

  it("asks for the key of a package it added", async () => {
    installBackend([VERIFIED], { ...PRIVATE_ON, slots: NEEDS_KEY.slots });
    await renderModal();
    addWithCode("good-code");
    await footerAction("Secret Tool", "Connect");
    expect(
      within(details("Secret Tool")).getByRole("status"),
    ).toHaveTextContent("Added. Connect your key to use it.");
    expect(
      within(details("Secret Tool")).getByRole("button", { name: "Remove" }),
    ).toBeTruthy();
  });

  it("shows an invalid code in place", async () => {
    installBackend([VERIFIED]);
    await renderModal();
    addWithCode("nope");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "That code isn’t valid",
    );
    expect(screen.getByLabelText("Activation code")).toBeTruthy();
  });

  it("reads and changes the open chat's packages only once the server stores that chat", async () => {
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
    actOn("Jupiter", "Turn off");
    await footerAction("Jupiter", "Turn on");
    expect(backend.choiceQueries).toEqual(["?thread_id=saved-chat"]);
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
