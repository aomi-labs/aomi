import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

import { PackagesModal } from "./packages-modal";
import { PackageRow } from "./package-row";
import { toCatalogPackage } from "./packages-catalog";
import { seedAccountOverview } from "@portal/lib/account-overview";

type FetchCall = { input: string | URL | Request; init?: RequestInit };

/** `GET /api/account/apps` wire rows (backend `AppSpec`, snake_case). */
const CATALOG = [
  { name: "default" },
  { name: "uniswap", is_public: true, application_id: 7 },
  {
    name: "stablefx",
    is_public: true,
    application_id: 8,
    chain_ids: [5_042_002],
  },
  {
    name: "treasury-ops",
    is_public: false,
    application_id: 9,
    label: "Treasury Ops",
  },
];

function installFetchRecorder() {
  const calls: FetchCall[] = [];
  let installed = ["default", "uniswap"];
  const fetchMock = vi.fn(
    async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({ input, init });
      const url = new URL(input.toString(), "https://portal.test");
      const method = init?.method ?? "GET";
      if (url.pathname === "/api/account/apps" && method === "GET") {
        return Response.json(CATALOG);
      }
      if (url.pathname === "/api/account/apps" && method === "PUT") {
        installed = (JSON.parse(String(init?.body)) as { apps: string[] }).apps;
        return Response.json({ apps: installed });
      }
      return new Response(`Unexpected ${method} ${url.pathname}`, {
        status: 500,
      });
    },
  );
  vi.stubGlobal("fetch", fetchMock);
  return { calls };
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
  beforeEach(() => {
    seedAccountOverview({
      user: { user_id: "acct-1", apps: ["default", "uniswap"] },
    });
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await act(async () => {
      seedAccountOverview(null);
    });
  });

  it("loads the catalog from the account apps route", async () => {
    const { calls } = installFetchRecorder();

    await renderModal();

    expect(paths(calls)).toContain("GET /api/account/apps");
    // Wire row + decoration: uniswap gets its brand name; installed from the
    // account overview.
    expect(screen.getAllByText("Uniswap").length).toBeGreaterThan(0);
    expect(screen.getByLabelText("Remove Uniswap")).toBeTruthy();
    // The pinned core app shows as built in, never removable.
    expect(screen.getByText("Built in")).toBeTruthy();
    expect(screen.queryByLabelText("Remove Aomi Core")).toBeNull();
    expect(screen.getByText("Circle StableFX")).toBeTruthy();
    expect(screen.getByText("Arc only")).toBeTruthy();
  });

  it("uses the same full-frame modal geometry as settings", async () => {
    installFetchRecorder();

    await renderModal();

    const dialog = screen.getByRole("dialog");
    expect(dialog.style.width).toBe("900px");
    expect(dialog.style.height).toBe("600px");
    expect(dialog.style.maxWidth).toBe("95%");
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
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });

  it("uninstalls by PUTting the replaced list", async () => {
    const { calls } = installFetchRecorder();

    const view = await renderModal();
    await act(async () => {
      fireEvent.click(screen.getByLabelText("Remove Uniswap"));
    });

    const put = calls.find((c) => c.init?.method === "PUT");
    expect(put).toBeTruthy();
    expect(JSON.parse(String(put?.init?.body))).toEqual({ apps: ["default"] });
    // The row flips from the PUT response, not optimistically.
    expect(screen.queryByLabelText("Remove Uniswap")).toBeNull();

    view.unmount();
    await renderModal();
    expect(screen.queryByLabelText("Remove Uniswap")).toBeNull();
  });

  it("installs a personal app through the same replace", async () => {
    const { calls } = installFetchRecorder();

    await renderModal();
    await act(async () => {
      fireEvent.click(screen.getByText("Personal"));
    });
    await act(async () => {
      fireEvent.click(screen.getByText("Install"));
    });

    const put = calls.find((c) => c.init?.method === "PUT");
    expect(JSON.parse(String(put?.init?.body))).toEqual({
      apps: ["default", "uniswap", "treasury-ops"],
    });
    expect(paths(calls)).toContain("PUT /api/account/apps");
  });

  it("blocks replacement until the installed-app baseline is available", async () => {
    seedAccountOverview(null);
    const { calls } = installFetchRecorder();

    await renderModal();

    const install = screen.getAllByText("Install")[0] as HTMLButtonElement;
    expect(install.disabled).toBe(true);
    fireEvent.click(install);
    expect(paths(calls)).not.toContain("PUT /api/account/apps");

    await act(async () => {
      seedAccountOverview({
        user: { user_id: "acct-1", apps: ["default", "uniswap"] },
      });
    });
    expect(
      (screen.getByLabelText("Remove Uniswap") as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it("serializes full-set replacements", async () => {
    const calls: FetchCall[] = [];
    let finishPut: ((response: Response) => void) | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        calls.push({ input, init });
        const url = new URL(input.toString(), "https://portal.test");
        if (url.pathname === "/api/account/apps" && !init?.method) {
          return Response.json(CATALOG);
        }
        if (url.pathname === "/api/account/apps" && init?.method === "PUT") {
          return new Promise<Response>((resolve) => {
            finishPut = resolve;
          });
        }
        return new Response("unexpected", { status: 500 });
      }),
    );

    await renderModal();
    const remove = screen.getByLabelText("Remove Uniswap");
    fireEvent.click(remove);
    fireEvent.click(remove);

    expect(
      paths(calls).filter((path) => path === "PUT /api/account/apps"),
    ).toHaveLength(1);

    await act(async () => {
      finishPut?.(Response.json({ apps: ["default"] }));
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
