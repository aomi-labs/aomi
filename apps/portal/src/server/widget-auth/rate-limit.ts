import {
  accountRateLimitStorage,
  clientIp,
} from "@aomi-labs/account/rate-limit";

import { clientIpHeader } from "@/server/env";

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** Widget sign-in budgets per client IP, shared with Better Auth's store. */
export const WIDGET_BUDGETS = {
  proof: { name: "proof", window: 60, max: 60 },
  // Each guest writes four rows, so creating them gets a tighter budget.
  guest: { name: "guest", window: 3600, max: 10 },
} as const;

export type WidgetBudget = (typeof WIDGET_BUDGETS)[keyof typeof WIDGET_BUDGETS];

export async function consumeWidgetBudget(
  request: Request,
  budget: WidgetBudget,
): Promise<Response | null> {
  const header = clientIpHeader();
  // Every local test browser shares the loopback address.
  const rule =
    !header && LOOPBACK.has(new URL(request.url).hostname)
      ? WIDGET_BUDGETS.proof
      : budget;
  const result = await accountRateLimitStorage.consume(
    `widget:${budget.name}:${clientIp(request, header)}`,
    { window: rule.window, max: rule.max },
  );
  return result.allowed
    ? null
    : Response.json(
        { error: "rate_limited" },
        { status: 429, headers: { "retry-after": String(result.retryAfter) } },
      );
}
