import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { UrlLink, urlLinkOptions } from "./url-link";
import { parseUrlSearch, stringifyUrlSearch } from "@/lib/url-search";

vi.unmock("@tanstack/react-router");

async function navigationRouter() {
  const root = createRootRoute({
    component: () => (
      <>
        <UrlLink href="/projects/57?platform=123&enabled=false&tab=logs&tab=usage#events">
          Open project
        </UrlLink>
        <UrlLink href="?tab=deployments">Deployment tab</UrlLink>
        <Outlet />
      </>
    ),
  });
  const projects = createRoute({
    getParentRoute: () => root,
    path: "/projects/$projectId",
    component: () => <p>Project</p>,
  });
  const router = createRouter({
    routeTree: root.addChildren([projects]),
    history: createMemoryHistory({
      initialEntries: ["/projects/42?platform=partner"],
    }),
    parseSearch: parseUrlSearch,
    stringifySearch: stringifyUrlSearch,
  });
  await router.load();
  return router;
}

describe("Build built-URL navigation", () => {
  beforeEach(() => vi.spyOn(window, "scrollTo").mockImplementation(() => {}));

  it("loads the dynamic route while retaining textual and repeated search values", async () => {
    const router = await navigationRouter();
    render(<RouterProvider router={router} />);
    const link = screen.getByRole("link", { name: "Open project" });
    expect(link).toHaveAttribute(
      "href",
      "/projects/57?platform=123&enabled=false&tab=logs&tab=usage#events",
    );
    fireEvent.click(link);
    await waitFor(() =>
      expect(router.state.location.pathname).toBe("/projects/57"),
    );
    expect(router.state.location.search).toEqual({
      platform: "123",
      enabled: "false",
      tab: ["logs", "usage"],
    });
    expect(router.state.location.hash).toBe("events");
  });

  it("resolves a query-only destination against the current project", async () => {
    const router = await navigationRouter();
    render(<RouterProvider router={router} />);
    const link = screen.getByRole("link", { name: "Deployment tab" });
    expect(link).toHaveAttribute("href", "/projects/42?tab=deployments");
    fireEvent.click(link);
    await waitFor(() =>
      expect(router.state.location.search).toEqual({ tab: "deployments" }),
    );
    expect(router.state.location.pathname).toBe("/projects/42");
  });

  it("retains current search for a hash-only destination and recognizes external URLs", async () => {
    const router = await navigationRouter();
    expect(router.buildLocation(urlLinkOptions("#events")).href).toBe(
      "/projects/42?platform=partner#events",
    );
    expect(urlLinkOptions("https://github.com/aomi-labs/aomi")).toEqual({
      to: "https://github.com/aomi-labs/aomi",
    });
  });
});
