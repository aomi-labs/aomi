import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";

import {
  inferLibraryCategory,
  PackagesModal,
} from "../../../../shadcn-registry/src/components/account-shell/components/shell/packages-modal";
import {
  PackageIcon,
  PackageRow,
} from "../../../../shadcn-registry/src/components/account-shell/components/shell/package-row";
import { toCatalogPackage } from "../../../../shadcn-registry/src/components/account-shell/components/shell/packages-catalog";
import {
  seedAccountOverview,
  useAccountOverview,
} from "../../../../shadcn-registry/src/components/account-shell/lib/account-overview";

type FetchCall = { input: string | URL | Request; init?: RequestInit };

const VENUE_SECRETS = [
  {
    name: "VENUE_API_KEY",
    description: "Personal trading API key",
    required: true,
    user_own: true,
  },
  {
    name: "VENUE_SUBACCOUNT",
    description: "Optional subaccount name",
    required: false,
    user_own: true,
  },
  {
    name: "SHARED_ENDPOINT",
    description: "Configured by the app",
    required: true,
    user_own: false,
  },
];

/** `GET /api/account/apps` wire rows (backend `AppSpec`, snake_case). */
const CATALOG = [
  { name: "default" },
  {
    name: "uniswap",
    is_public: true,
    application_id: 7,
    metadata: { registered_via: "official_source" },
    feature_catalog: ["cross-chain"],
  },
  {
    name: "oneinch",
    is_public: true,
    application_id: 10,
    label: "Exchange Aggregator",
    metadata: { registered_via: "official_source" },
    feature_catalog: ["cross-chain"],
  },
  {
    name: "polymarket_rewards",
    is_public: true,
    application_id: 11,
    label: "Market Incentives",
    metadata: { registered_via: "official_source" },
    feature_catalog: ["trading"],
  },
  {
    name: "stablefx",
    is_public: true,
    application_id: 8,
    chain_ids: [5_042_002],
    metadata: { registered_via: "official_source" },
    feature_catalog: ["trading"],
  },
  {
    name: "treasury-ops",
    is_public: false,
    application_id: 9,
    label: "Treasury Ops",
  },
  {
    name: "venue",
    is_public: true,
    application_id: 12,
    label: "Venue",
    secrets: VENUE_SECRETS,
  },
];

function installFetchRecorder(
  extraApps: Array<{
    name: string;
    is_public: boolean;
    application_id: number;
    label: string;
    metadata: { registered_via: string };
    feature_catalog: string[];
  }> = [],
  initiallyInstalled: number[] = [7],
) {
  const calls: FetchCall[] = [];
  const catalog = [...CATALOG, ...extraApps];
  const installed = new Set(initiallyInstalled);
  let venueConfigured = false;
  let failNextVenueRead = false;
  let failNextVenueSave = false;
  const fetchMock = vi.fn(
    async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({ input, init });
      const url = new URL(input.toString(), "https://portal.test");
      const method = init?.method ?? "GET";
      if (url.pathname === "/api/thread/apps" && method === "GET") {
        return Response.json(catalog.filter((app) => app.is_public !== false));
      }
      if (url.pathname === "/api/account/apps" && method === "GET") {
        return Response.json(
          catalog.map((app) => ({
            ...app,
            is_installed:
              "application_id" in app && app.application_id != null
                ? installed.has(app.application_id)
                : false,
          })),
        );
      }
      if (url.pathname === "/api/account/apps/12/secrets" && method === "GET") {
        if (failNextVenueRead) {
          failNextVenueRead = false;
          return new Response("temporary failure", { status: 503 });
        }
        return Response.json({
          application_id: 12,
          app: "venue",
          ready: venueConfigured,
          missing_required: venueConfigured ? [] : ["VENUE_API_KEY"],
          slots: VENUE_SECRETS.filter((slot) => slot.user_own).map((slot) => ({
            ...slot,
            configured: slot.name === "VENUE_API_KEY" && venueConfigured,
            app_provided: false,
          })),
        });
      }
      if (
        url.pathname === "/api/account/apps/12/secrets" &&
        method === "POST"
      ) {
        if (failNextVenueSave) {
          failNextVenueSave = false;
          return new Response("temporary failure", { status: 503 });
        }
        const secrets = (
          JSON.parse(String(init?.body)) as {
            secrets: Record<string, string>;
          }
        ).secrets;
        venueConfigured = Boolean(secrets.VENUE_API_KEY) || venueConfigured;
        return Response.json({
          application_id: 12,
          app: "venue",
          ready: venueConfigured,
          missing_required: venueConfigured ? [] : ["VENUE_API_KEY"],
          slots: VENUE_SECRETS.filter((slot) => slot.user_own).map((slot) => ({
            ...slot,
            configured: Boolean(secrets[slot.name]),
            app_provided: false,
          })),
        });
      }
      if (
        url.pathname === "/api/account/apps/12/secrets/VENUE_API_KEY" &&
        method === "DELETE"
      ) {
        venueConfigured = false;
        return Response.json({ deleted: true });
      }
      const appMutation = url.pathname.match(/^\/api\/account\/apps\/(\d+)$/);
      if (appMutation && (method === "POST" || method === "DELETE")) {
        const applicationId = Number(appMutation[1]);
        const app = catalog.find(
          (candidate) =>
            "application_id" in candidate &&
            candidate.application_id === applicationId,
        );
        if (!app) return new Response("Not found", { status: 404 });
        if (method === "POST") installed.add(applicationId);
        else installed.delete(applicationId);
        return Response.json({
          application_id: applicationId,
          app: app.name,
          installed: method === "POST",
          apps: [
            "default",
            ...new Set(
              catalog
                .filter(
                  (candidate) =>
                    "application_id" in candidate &&
                    installed.has(candidate.application_id),
                )
                .map((candidate) => candidate.name),
            ),
          ],
        });
      }
      if (url.pathname === "/api/resource/skills" && method === "GET") {
        return Response.json({
          skills: [
            {
              id: "aave",
              name: "aave",
              description: "Supply and borrow through Aave V3.",
              tags: ["lending"],
              feature_catalog: ["lending"],
              chain_ids: [1, 8453],
              injected_tools: ["aave_position"],
            },
          ],
        });
      }
      if (url.pathname === "/api/resource/skills/aave" && method === "GET") {
        return Response.json({
          id: "aave",
          name: "aave",
          description: "Supply and borrow through Aave V3.",
          tags: ["lending"],
          feature_catalog: ["lending"],
          chain_ids: [1, 8453],
          injected_tools: ["aave_position"],
          tool_names: ["aomi_call_tool"],
          instructions: "Use the Aave procedure.",
        });
      }
      return new Response(`Unexpected ${method} ${url.pathname}`, {
        status: 500,
      });
    },
  );
  vi.stubGlobal("fetch", fetchMock);
  return {
    calls,
    failNextVenueRead: () => {
      failNextVenueRead = true;
    },
    failNextVenueSave: () => {
      failNextVenueSave = true;
    },
  };
}

const paths = (calls: FetchCall[]) =>
  calls.map(
    (c) =>
      `${c.init?.method ?? "GET"} ${new URL(c.input.toString(), "https://portal.test").pathname}`,
  );

async function renderModal() {
  let view: ReturnType<typeof render> | undefined;
  await act(async () => {
    view = render(<PackagesModal onClose={() => undefined} />);
  });
  if (!view) throw new Error("Packages modal did not render");
  return view;
}

describe("packages modal wiring", () => {
  it("shows failed mutations beside the mobile detail controls", async () => {
    installFetchRecorder();
    await renderModal();
    fireEvent.click(screen.getByLabelText("Open Uniswap details"));
    vi.mocked(fetch).mockResolvedValueOnce(
      Response.json({ error: "Could not save apps" }, { status: 500 }),
    );
    fireEvent.click(screen.getByLabelText("Remove Uniswap"));
    const detailView = screen.getByRole("button", {
      name: "Back to library",
    }).parentElement!;
    expect(await within(detailView).findByRole("alert")).toHaveTextContent(
      /.+/,
    );
    expect(screen.getByLabelText("Remove Uniswap")).toBeEnabled();
  });

  beforeEach(() => {
    seedAccountOverview({
      user: {
        user_id: "acct-1",
        apps: ["default", "uniswap"],
        application_ids: [7],
      },
    });
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await act(async () => {
      seedAccountOverview(null);
    });
  });

  it("lets guests browse public apps without account catalog access or install writes", async () => {
    seedAccountOverview(null);
    const { calls } = installFetchRecorder();
    await renderModal();
    expect(paths(calls)).toContain("GET /api/thread/apps");
    expect(paths(calls)).not.toContain("GET /api/account/apps");
    expect(
      screen.getByRole("button", { name: "Open Uniswap details" }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Open Treasury Ops details" }),
    ).toBeNull();
    expect(
      screen.getByRole("button", { name: "Add Uniswap", exact: true }),
    ).toBeDisabled();
    fireEvent.click(screen.getByLabelText("Open Venue details"));
    expect(
      screen.getByText("Sign in to save credentials and add this app."),
    ).toBeTruthy();
    expect(screen.getByLabelText("VENUE_API_KEY")).toBeDisabled();
    expect(paths(calls)).not.toContain("GET /api/account/apps/12/secrets");
    expect(paths(calls)).not.toContain("POST /api/account/apps/12");
  });

  it("loads the catalog from the account apps route", async () => {
    const { calls } = installFetchRecorder();

    await renderModal();

    expect(paths(calls)).toContain("GET /api/account/apps");
    // Wire row + decoration: installed apps are presented first and open into
    // the shared inspector rather than exposing destructive row controls.
    expect(screen.getAllByText("Uniswap").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByLabelText("Open Uniswap details"));
    expect(screen.getByLabelText("Remove Uniswap")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Open Aomi Core details"));
    expect(screen.getByText("Built in")).toBeTruthy();
    expect(screen.queryByLabelText("Remove Aomi Core")).toBeNull();
    expect(screen.getByText("Circle StableFX")).toBeTruthy();
    expect(screen.getByText("Arc only")).toBeTruthy();
  });

  it("keeps apps and skills in the directory with a persistent inspector", async () => {
    const { calls } = installFetchRecorder();

    await renderModal();

    expect(screen.getByRole("dialog", { name: "Library" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Library" })).toHaveClass(
      "text-[15px]",
    );
    expect(screen.getByRole("button", { name: /Discover/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: /Discover/ })).toHaveClass(
      "text-[13px]",
    );
    expect(screen.getByRole("textbox", { name: "Search library" })).toHaveClass(
      "md:text-[14px]",
    );
    expect(screen.getByLabelText("Aave details").className).toContain(
      "border-l",
    );
    expect(screen.getByLabelText("Try Aave")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Skills/ }));
    expect(screen.getByRole("heading", { name: "Skills" })).toBeTruthy();
    expect(await screen.findByText("How it works")).toBeTruthy();
    expect(await screen.findByText("2 actions available")).toBeTruthy();
    expect(paths(calls)).toContain("GET /api/resource/skills/aave");
  });

  it("finds curated apps by wire name and original catalog label", async () => {
    installFetchRecorder();
    await renderModal();

    const search = screen.getByRole("textbox", { name: "Search library" });

    fireEvent.change(search, { target: { value: "oneinch" } });
    expect(screen.getByLabelText("Open 1inch details")).toBeTruthy();

    fireEvent.change(search, { target: { value: "polymarket_rewards" } });
    expect(
      screen.getByLabelText("Open Polymarket Rewards details"),
    ).toBeTruthy();

    fireEvent.change(search, { target: { value: "Market Incentives" } });
    expect(
      screen.getByLabelText("Open Polymarket Rewards details"),
    ).toBeTruthy();
  });

  it("keeps same-name community rows stable across tabs and global search", async () => {
    const { calls } = installFetchRecorder([
      {
        name: "dune",
        is_public: true,
        application_id: 40,
        label: "Dune",
        metadata: { registered_via: "official_source" },
        feature_catalog: ["research"],
      },
      {
        name: "dune",
        is_public: true,
        application_id: 41,
        label: "My Dune",
        metadata: { registered_via: "activate_apps" },
        feature_catalog: [],
      },
    ]);
    await renderModal();

    fireEvent.click(screen.getByRole("button", { name: /^Apps\b/ }));
    expect(screen.getByLabelText("Open Dune details")).toBeTruthy();
    expect(screen.getByLabelText("Open My Dune details")).toBeTruthy();
    expect(screen.getByText("Community apps")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /^Skills\b/ }));
    expect(screen.queryByLabelText("Open My Dune details")).toBeNull();
    expect(screen.getByLabelText("Open Aave details")).toBeTruthy();

    fireEvent.change(screen.getByRole("textbox", { name: "Search library" }), {
      target: { value: "dune" },
    });
    expect(screen.getByLabelText("Open Dune details")).toBeTruthy();
    expect(screen.getByLabelText("Open My Dune details")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Open My Dune details"));
    expect(screen.getByLabelText("My Dune details")).toBeTruthy();
    const install = screen
      .getAllByLabelText("Add My Dune")
      .find((button) => !(button as HTMLButtonElement).disabled);
    expect(install).toBeTruthy();
    fireEvent.click(install!);
    await waitFor(() =>
      expect(paths(calls)).toContain("POST /api/account/apps/41"),
    );
    expect(paths(calls)).not.toContain("POST /api/account/apps/40");
  });

  it("puts token operations in Tokens & wallets before broad research matches", () => {
    expect(
      inferLibraryCategory({
        kind: "skill",
        item: {
          id: "common_erc20",
          name: "common erc20",
          description: "Check balances, allowances, and token transfers.",
          tags: ["tokens"],
          featureCatalog: ["wallets"],
          chainIds: [1, 8453],
          injectedTools: [],
        },
      }),
    ).toBe("wallets");
  });

  it("sends a skill to chat as a capability mention", async () => {
    installFetchRecorder();
    const onMention = vi.fn();
    window.addEventListener("aomi:capability-mention-request", onMention);

    await renderModal();
    fireEvent.click(screen.getAllByLabelText("Try Aave")[0]);

    expect(onMention).toHaveBeenCalledOnce();
    expect((onMention.mock.calls[0][0] as CustomEvent).detail).toEqual({
      kind: "skill",
      id: "aave",
    });
    window.removeEventListener("aomi:capability-mention-request", onMention);
  });

  it("uses the same full-frame modal geometry as settings", async () => {
    installFetchRecorder();

    await renderModal();

    const dialog = screen.getByRole("dialog");
    expect(dialog.style.width).toBe("1080px");
    expect(dialog.style.height).toBe("620px");
    expect(dialog.style.maxWidth).toBe("96%");
    expect(dialog.style.maxHeight).toBe("92%");
    expect(dialog.parentElement?.className).toContain("absolute");
    expect(dialog.parentElement?.className).not.toContain("fixed");
  });

  it("does not render an HTML proxy failure inside the window", async () => {
    const fetchMock = vi.fn(async () => {
      return new Response("<!DOCTYPE html><html>proxy failure</html>", {
        status: 500,
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await renderModal();

    expect(
      await screen.findByText("Couldn’t load packages. Please try again."),
    ).toBeTruthy();
    expect(screen.queryByText(/DOCTYPE/)).toBeNull();

    fireEvent.click(screen.getByText("Retry"));
    await waitFor(() => {
      const appRequests = fetchMock.mock.calls.filter(([input]) =>
        input.toString().startsWith("/api/account/apps"),
      );
      expect(appRequests).toHaveLength(2);
    });
  });

  it("uninstalls by exact application ID", async () => {
    const { calls } = installFetchRecorder();

    const view = await renderModal();
    await act(async () => {
      fireEvent.click(screen.getByLabelText("Open Uniswap details"));
    });
    await act(async () => {
      fireEvent.click(screen.getByLabelText("Remove Uniswap"));
    });

    expect(paths(calls)).toContain("DELETE /api/account/apps/7");
    // The row flips from the server response, not optimistically.
    expect(screen.queryByLabelText("Remove Uniswap")).toBeNull();

    view.unmount();
    await renderModal();
    expect(screen.queryByLabelText("Remove Uniswap")).toBeNull();
  });

  it("installs a personal app by exact application ID", async () => {
    const { calls } = installFetchRecorder();

    await renderModal();
    await act(async () => {
      fireEvent.click(screen.getByLabelText("Add Treasury Ops"));
    });

    expect(paths(calls)).toContain("POST /api/account/apps/9");
  });

  it("saves required user credentials before adding an app", async () => {
    const { calls } = installFetchRecorder();
    await renderModal();

    fireEvent.click(screen.getByLabelText("Set up Venue"));
    expect(await screen.findByText("Personal trading API key")).toBeTruthy();
    expect(screen.getByText("Optional subaccount name")).toBeTruthy();
    expect(screen.queryByText("Configured by the app")).toBeNull();
    expect(screen.getByLabelText("VENUE_API_KEY")).toHaveAttribute(
      "type",
      "password",
    );
    expect(screen.getByLabelText("Add Venue")).toBeDisabled();

    fireEvent.change(screen.getByLabelText("VENUE_API_KEY"), {
      target: { value: " secret-value " },
    });
    fireEvent.click(screen.getByText("Save & add app"));

    await waitFor(() => {
      expect(paths(calls)).toContain("POST /api/account/apps/12/secrets");
      expect(paths(calls)).toContain("POST /api/account/apps/12");
    });
    const save = calls.find(
      (call) =>
        call.init?.method === "POST" &&
        call.input.toString().includes("/api/account/apps/12/secrets"),
    );
    expect(JSON.parse(String(save?.init?.body))).toEqual({
      secrets: { VENUE_API_KEY: "secret-value" },
    });
    expect(screen.queryByDisplayValue("secret-value")).toBeNull();
    expect(screen.getByLabelText("Remove Venue")).toBeTruthy();
  });

  it("discards unsaved credentials when setup is cancelled", async () => {
    installFetchRecorder();
    await renderModal();

    fireEvent.click(screen.getByLabelText("Set up Venue"));
    fireEvent.change(await screen.findByLabelText("VENUE_API_KEY"), {
      target: { value: "never-persist-this-draft" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Back to library" }));
    fireEvent.click(screen.getByLabelText("Open Venue details"));

    expect(await screen.findByLabelText("VENUE_API_KEY")).toHaveValue("");
  });

  it("shows saved status and supports replacing and removing without revealing values", async () => {
    seedAccountOverview({
      user: { user_id: "acct-1", apps: ["default", "uniswap", "venue"] },
    });
    const { calls } = installFetchRecorder([], [7, 12]);
    await renderModal();
    fireEvent.click(screen.getByLabelText("Open Venue details"));

    fireEvent.change(await screen.findByLabelText("VENUE_API_KEY"), {
      target: { value: "replacement" },
    });
    fireEvent.click(screen.getByText("Save changes"));
    await waitFor(() =>
      expect(paths(calls)).toContain("POST /api/account/apps/12/secrets"),
    );
    expect(screen.queryByDisplayValue("replacement")).toBeNull();
    expect(await screen.findByText("Required · Saved")).toBeTruthy();

    fireEvent.click(screen.getByLabelText("Remove VENUE_API_KEY"));
    await waitFor(() =>
      expect(paths(calls)).toContain(
        "DELETE /api/account/apps/12/secrets/VENUE_API_KEY",
      ),
    );
    expect(await screen.findByText("Setup required")).toBeTruthy();
  });

  it("keeps save failures actionable and retries a failed status read", async () => {
    const { failNextVenueRead, failNextVenueSave } = installFetchRecorder();
    await renderModal();

    failNextVenueRead();
    fireEvent.click(screen.getByLabelText("Open Venue details"));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /temporary failure/i,
    );
    fireEvent.click(screen.getByText("Retry"));
    expect(await screen.findByText("Setup required")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("VENUE_API_KEY"), {
      target: { value: "secret-value" },
    });
    failNextVenueSave();
    fireEvent.click(screen.getByText("Save & add app"));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /temporary failure/i,
    );
    expect(
      screen.queryByText(
        "Add every required credential before activating this app.",
      ),
    ).toBeNull();
  });

  it("uses the server catalog as the installed-app baseline", async () => {
    seedAccountOverview({ user: { user_id: "acct-1" } });
    const { calls } = installFetchRecorder();

    await renderModal();

    const install = screen.getByLabelText(
      "Add Treasury Ops",
    ) as HTMLButtonElement;
    expect(install.disabled).toBe(false);
    fireEvent.click(install);
    expect(paths(calls)).toContain("POST /api/account/apps/9");

    await act(async () => {
      seedAccountOverview({
        user: {
          user_id: "acct-1",
          apps: ["default", "uniswap"],
          application_ids: [7],
        },
      });
    });
    fireEvent.click(screen.getByLabelText("Open Uniswap details"));
    expect(
      (screen.getByLabelText("Remove Uniswap") as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it("ignores a pending install response after sign-out and modal unmount", async () => {
    let finishMutation: ((response: Response) => void) | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const path = new URL(input.toString(), "https://portal.test").pathname;
        if (path === "/api/account/apps/9" && init?.method === "POST") {
          return new Promise<Response>((resolve) => {
            finishMutation = resolve;
          });
        }
        if (path === "/api/account/apps") {
          return Response.json(
            CATALOG.map((app) => ({
              ...app,
              is_installed: "application_id" in app && app.application_id === 7,
            })),
          );
        }
        if (path === "/api/resource/skills") {
          return Response.json({ skills: [] });
        }
        return new Response("Unauthenticated", { status: 401 });
      }),
    );
    const view = await renderModal();
    fireEvent.click(screen.getByLabelText("Add Treasury Ops"));
    expect(finishMutation).toBeTypeOf("function");
    view.unmount();
    seedAccountOverview(null);

    await act(async () => {
      finishMutation?.(
        Response.json({
          application_id: 9,
          app: "treasury-ops",
          installed: true,
          apps: ["default", "uniswap", "treasury-ops"],
        }),
      );
    });
    function AccountIdentity() {
      return <span>{useAccountOverview()?.user.user_id ?? "signed-out"}</span>;
    }
    render(<AccountIdentity />);
    expect(screen.getByText("signed-out")).toBeTruthy();
    expect(screen.queryByText("acct-1")).toBeNull();
  });

  it("serializes exact app mutations", async () => {
    const calls: FetchCall[] = [];
    let finishMutation: ((response: Response) => void) | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        calls.push({ input, init });
        const url = new URL(input.toString(), "https://portal.test");
        if (url.pathname === "/api/account/apps" && !init?.method) {
          return Response.json(
            CATALOG.map((app) => ({
              ...app,
              is_installed: "application_id" in app && app.application_id === 7,
            })),
          );
        }
        if (
          url.pathname === "/api/account/apps/7" &&
          init?.method === "DELETE"
        ) {
          return new Promise<Response>((resolve) => {
            finishMutation = resolve;
          });
        }
        if (url.pathname === "/api/resource/skills") {
          return Response.json({ skills: [] });
        }
        return new Response("unexpected", { status: 500 });
      }),
    );

    await renderModal();
    fireEvent.click(screen.getByLabelText("Open Uniswap details"));
    const remove = screen.getByLabelText("Remove Uniswap");
    fireEvent.click(remove);
    fireEvent.click(remove);

    expect(
      paths(calls).filter((path) => path === "DELETE /api/account/apps/7"),
    ).toHaveLength(1);

    await act(async () => {
      finishMutation?.(
        Response.json({
          application_id: 7,
          app: "uniswap",
          installed: false,
          apps: ["default"],
        }),
      );
    });
  });
});

describe("chain-scoped package rows", () => {
  it("blocks StableFX installation until Arc Testnet is selected", () => {
    const app = toCatalogPackage({
      name: "stablefx",
      chainIds: [5_042_002],
    });

    render(
      <PackageRow
        app={app}
        installed={false}
        busy={false}
        disabled={false}
        activeChainId={1}
        onInstall={() => undefined}
        onUninstall={() => undefined}
      />,
    );

    const button = screen.getByLabelText(
      "Switch to Arc Testnet to install Circle StableFX",
    );
    expect(button).toBeDisabled();
  });

  it("keeps chain-scoped installation disabled while the wallet chain is unknown", () => {
    const app = toCatalogPackage({
      name: "stablefx",
      chainIds: [5_042_002],
    });

    render(
      <PackageRow
        app={app}
        installed={false}
        busy={false}
        disabled={false}
        onInstall={() => undefined}
        onUninstall={() => undefined}
      />,
    );

    expect(
      screen.getByLabelText("Switch to Arc Testnet to install Circle StableFX"),
    ).toBeDisabled();
  });
});

describe("catalog app identity", () => {
  it("keeps backend identity while using the shared curated presentation", () => {
    const app = toCatalogPackage({
      name: "LI.FI",
      label: "messy backend label",
      applicationId: 42,
      isPublic: true,
      metadata: { registered_via: "official_source" },
    });

    expect(app).toMatchObject({
      id: "LI.FI",
      applicationId: 42,
      brandId: "lifi",
      name: "LI.FI",
    });
  });

  it("keeps a private app with a known wire name on its custom identity", () => {
    const app = toCatalogPackage({
      name: "dune",
      label: "Team Dune",
      applicationId: "private-7",
      isPublic: false,
    });

    expect(app).toMatchObject({
      id: "dune",
      applicationId: "private-7",
      brandId: "",
      name: "Team Dune",
      visibility: "personal",
      category: "Your packages",
      pinned: false,
    });

    const view = render(<PackageIcon app={app} size="small" />);
    expect(view.container.querySelector("svg")).toBeNull();
    expect(view.container.textContent).toBe(app.abbr);
  });

  it("renders known local marks without a remote favicon style", () => {
    const app = toCatalogPackage({ name: "dune", isPublic: true });
    const view = render(<PackageIcon app={app} size="detail" />);
    const icon = screen.getByLabelText("Dune");

    expect(icon).toHaveClass("size-12", "bg-aomi-surface-2");
    expect(icon.querySelector("svg")).toHaveClass("size-7");
    expect(view.container.innerHTML).not.toContain("google.com/s2/favicons");
    expect(view.container.innerHTML).not.toContain("background-image");
  });
});
