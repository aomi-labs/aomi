import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { describe, expect, it } from "vitest";

import { usePortalUrlNavigation } from "./navigation";
import { useRequestedAppConfig } from "./portal-client-options";
import { parseUrlSearch, stringifyUrlSearch } from "./url-search";

function NavigationHarness() {
  const navigation = usePortalUrlNavigation();
  const config = useRequestedAppConfig();
  return (
    <>
      <output data-testid="router-url">{navigation.href}</output>
      <output data-testid="app-config">{JSON.stringify(config)}</output>
      <button
        onClick={() => {
          const url = new URL(navigation.href, "http://portal.local");
          url.searchParams.set("thread", "selected");
          void navigation.push(url);
        }}
      >
        Select chat
      </button>
      <button
        onClick={() => {
          const url = new URL(navigation.href, "http://portal.local");
          url.searchParams.delete("thread");
          void navigation.replace(url);
        }}
      >
        Clear unavailable chat
      </button>
    </>
  );
}

async function renderRouter(href: string) {
  const root = createRootRoute({ component: Outlet });
  const index = createRoute({
    getParentRoute: () => root,
    path: "/",
    component: NavigationHarness,
  });
  const router = createRouter({
    routeTree: root.addChildren([index]),
    history: createMemoryHistory({ initialEntries: [href] }),
    parseSearch: parseUrlSearch,
    stringifySearch: stringifyUrlSearch,
  });
  await router.load();
  render(<RouterProvider router={router} />);
  return router;
}

describe("Portal Router navigation", () => {
  it("preserves app scope, unknown search fields, and fragments across chat history", async () => {
    const initialHref =
      "/?app=goal&application_id=17&lock_app=1&tracking=a%2Bb#composer";
    const router = await renderRouter(initialHref);

    fireEvent.click(screen.getByRole("button", { name: "Select chat" }));
    await waitFor(() =>
      expect(screen.getByTestId("router-url")).toHaveTextContent(
        "thread=selected",
      ),
    );
    const selectedHref = screen.getByTestId("router-url").textContent!;
    const selected = new URL(selectedHref, "http://portal.local");
    expect(selected.searchParams.get("application_id")).toBe("17");
    expect(selected.searchParams.get("tracking")).toBe("a+b");
    expect(selected.hash).toBe("#composer");

    await act(async () => {
      router.history.back();
    });
    await waitFor(() =>
      expect(screen.getByTestId("router-url")).toHaveTextContent(initialHref),
    );
    await act(async () => {
      router.history.forward();
    });
    await waitFor(() =>
      expect(screen.getByTestId("router-url")).toHaveTextContent(selectedHref),
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Clear unavailable chat" }),
    );
    await waitFor(() =>
      expect(screen.getByTestId("router-url")).not.toHaveTextContent("thread="),
    );
    await act(async () => {
      router.history.back();
    });
    await waitFor(() =>
      expect(screen.getByTestId("router-url")).toHaveTextContent(initialHref),
    );
  });

  it("updates requested app policy when Router location changes", async () => {
    const router = await renderRouter(
      "/?app=first&application_id=17&lock_app=1",
    );
    expect(JSON.parse(screen.getByTestId("app-config").textContent!)).toEqual({
      app: "first",
      applicationId: "17",
      locked: true,
    });

    await act(async () => {
      await router.navigate({
        href: "/?aomi_app=next&applicationId=18&app_locked=true&funding=user_byok",
      });
    });
    expect(JSON.parse(screen.getByTestId("app-config").textContent!)).toEqual({
      app: "next",
      applicationId: "18",
      locked: true,
      inferenceFunding: "user_byok",
    });
  });
});
