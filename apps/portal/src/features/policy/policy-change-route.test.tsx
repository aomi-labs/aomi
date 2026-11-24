import { describe, expect, it, vi } from "vitest";

vi.mock("./policy-change-client", () => ({ PolicyChangeClient: () => null }));

import { Route } from "@/routes/policy.$changeId";
import { Route as OldRoute } from "@/routes/rules.$changeId";

describe("/policy/$changeId", () => {
  it("is the page a policy change is reviewed on", async () => {
    expect(Route.options.component).toBeTypeOf("function");
    const head = await Route.options.head!({} as never);
    expect(head?.meta).toContainEqual({ title: "Review policy change — Aomi" });
  });

  it("is where /rules/$changeId, the address Telegram links, redirects", () => {
    let thrown: unknown;
    try {
      OldRoute.options.beforeLoad!({ params: { changeId: "ch-1" } } as never);
    } catch (caught) {
      thrown = caught;
    }
    expect(thrown).toMatchObject({
      options: { to: "/policy/$changeId", params: { changeId: "ch-1" } },
    });
  });
});
