// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => [] as unknown[]);
vi.mock("@/server/bff/routes", () => {
  const handler = (_request: Request, context?: { params?: Promise<unknown> }) => {
    calls.push(context?.params);
    return new Response(null, { status: 204 });
  };
  const binding = { PATCH: handler, DELETE: handler, OPTIONS: handler };
  return { routes: { identity: binding, wallet: binding } };
});

import { Route as IdentityRoute } from "@/routes/v1.account.identities.$id";
import { Route as WalletRoute } from "@/routes/v1.account.wallets.$id";

type Handlers = Record<
  string,
  (ctx: { request: Request; params: { id: string } }) => Promise<Response>
>;

describe("account :id routes", () => {
  it.each([
    ["identities", IdentityRoute],
    ["wallets", WalletRoute],
  ])("forwards the %s id to the handler", async (_name, route) => {
    const handlers = route.options.server!.handlers as unknown as Handlers;
    for (const method of ["PATCH", "DELETE"]) {
      calls.length = 0;
      const request = new Request("https://portal.example/x", { method });
      await handlers[method]!({ request, params: { id: "abc" } });
      expect(await calls[0]).toEqual({ id: "abc" });
    }
  });
});
