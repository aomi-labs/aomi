import { describe, expect, it, vi } from "vitest";

vi.mock("./rule-change-client", () => ({ RuleChangeClient: () => null }));

import { Route } from "@/routes/rules.$changeId";

describe("/rules/$changeId", () => {
  it("is the page Telegram links a rule change to", async () => {
    expect(Route.options.component).toBeTypeOf("function");
    const head = await Route.options.head!({} as never);
    expect(head?.meta).toContainEqual({ title: "Review rule change — Aomi" });
  });
});
