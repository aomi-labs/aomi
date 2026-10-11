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

describe("Telegram router", () => {
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
    render(<Wrap><QueryOwner /></Wrap>);
  });

  it("serializes only successful queries explicitly approved for SSR", async () => {
    const client = getRouter().options.context.queryClient;
    client.setQueryData(["private-account"], "secret account");
    await client.fetchQuery({
      queryKey: ["public-config"],
      queryFn: async () => "public",
      meta: { ssrSafe: true },
    });
    await client.fetchQuery({
      queryKey: ["failed-public"],
      queryFn: async () => { throw new Error("failed"); },
      retry: false,
      meta: { ssrSafe: true },
    }).catch(() => undefined);
    const mutation = client.getMutationCache().build(client, {
      mutationFn: async () => "secret mutation",
    });
    await mutation.execute(undefined);
    const serialized = dehydrate(client);
    expect(serialized.queries.map((query) => query.queryKey)).toEqual([["public-config"]]);
    expect(serialized.mutations).toEqual([]);
    expect(JSON.stringify(serialized)).not.toContain("secret");
  });

  it("keeps opaque launch identifiers and repeated search values as strings", () => {
    const router = getRouter();
    const search = router.options.parseSearch!(
      "?bot_id=0009007199254740993&session_id=telegram%3Adm%3A7%2B8&tag=01&tag=false",
    );
    expect(search).toEqual({
      bot_id: "0009007199254740993",
      session_id: "telegram:dm:7+8",
      tag: ["01", "false"],
    });
    const location = router.buildLocation({ to: "/", search });
    const query = new URLSearchParams(location.searchStr);
    expect(query.get("bot_id")).toBe("0009007199254740993");
    expect(query.get("session_id")).toBe("telegram:dm:7+8");
    expect(query.getAll("tag")).toEqual(["01", "false"]);
  });
});
