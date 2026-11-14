import {
  AccountGraphApiError,
  type AccountPoliciesTransport,
} from "@aomi-labs/client";
import { describe, expect, it, vi } from "vitest";

import {
  atomicToSol,
  confirmPolicyRevoke,
  explainPolicyError,
  fromAtomic,
} from "@/account/policy/policy-api";

describe("headless on-chain policy wire model", () => {
  it("shows atomic amounts without floating-point rounding", () => {
    expect(atomicToSol("1000000001")).toBe("1.000000001");
    expect(fromAtomic("25000000", 6)).toBe("25");
  });

  it("retries a confirm the backend's RPC node has not caught up with", async () => {
    const lagging = new AccountGraphApiError(
      409,
      { error: "still there", error_code: "role_still_active" },
      "",
    );
    const confirmRevoke = vi
      .fn()
      .mockRejectedValueOnce(lagging)
      .mockResolvedValueOnce({ operation: "revoke" });
    const policies = { confirmRevoke } as unknown as AccountPoliciesTransport;
    await expect(confirmPolicyRevoke(policies, 7, "sig", 0)).resolves.toEqual({
      operation: "revoke",
    });
    expect(confirmRevoke).toHaveBeenCalledTimes(2);
    expect(confirmRevoke).toHaveBeenCalledWith(7, "sig");

    const stale = new AccountGraphApiError(
      409,
      { error: "gone", error_code: "stale_policy_binding" },
      "",
    );
    const refused = vi.fn().mockRejectedValue(stale);
    await expect(
      confirmPolicyRevoke(
        { confirmRevoke: refused } as unknown as AccountPoliciesTransport,
        7,
        "sig",
        0,
      ),
    ).rejects.toBe(stale);
    expect(refused).toHaveBeenCalledTimes(1);
    expect(explainPolicyError(stale)).toContain("changed elsewhere");
  });
});
