import { dehydrate, useQueryClient } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { getRouter } from "./router";

vi.mock("./routeTree.gen", async () => {
  const { createRootRouteWithContext } = await vi.importActual<
    typeof import("@tanstack/react-router")
  >("@tanstack/react-router");
  return { routeTree: createRootRouteWithContext()() };
});

describe("Portal router query ownership", () => {
  it("creates isolated request caches and provides the router's own client", () => {
    const first = getRouter();
    const second = getRouter();
    const firstClient = first.options.context.queryClient;
    const secondClient = second.options.context.queryClient;
    firstClient.setQueryData(["private-account"], "first account");
    expect(secondClient).not.toBe(firstClient);
    expect(secondClient.getQueryData(["private-account"])).toBeUndefined();
    const Wrap = first.options.Wrap!;
    function QueryOwner() {
      expect(useQueryClient()).toBe(firstClient);
      return null;
    }
    render(
      <Wrap>
        <QueryOwner />
      </Wrap>,
    );
  });

  it("serializes only successful queries explicitly approved for SSR", async () => {
    const client = getRouter().options.context.queryClient;
    client.setQueryData(["private-projects"], ["secret project"]);
    await client.fetchQuery({
      queryKey: ["public-config"],
      queryFn: async () => "public",
      meta: { ssrSafe: true },
    });
    await client
      .fetchQuery({
        queryKey: ["failed-public"],
        queryFn: async () => {
          throw new Error("failed");
        },
        retry: false,
        meta: { ssrSafe: true },
      })
      .catch(() => undefined);
    const mutation = client
      .getMutationCache()
      .build(client, { mutationFn: async () => "secret mutation" });
    await mutation.execute(undefined);
    const serialized = dehydrate(client);
    expect(serialized.queries.map((query) => query.queryKey)).toEqual([
      ["public-config"],
    ]);
    expect(serialized.mutations).toEqual([]);
    expect(JSON.stringify(serialized)).not.toContain("secret");
  });
});
