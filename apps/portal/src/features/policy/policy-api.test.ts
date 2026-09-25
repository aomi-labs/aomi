import { describe, expect, it, vi } from "vitest";

import {
  atomicToSol,
  confirmPolicyRevoke,
  explainPolicyError,
  policyFromForm,
  solToAtomic,
} from "../../../../shadcn-registry/src/components/account-shell/features/policy/policy-api";

describe("headless on-chain policy wire model", () => {
  it("converts SOL without floating-point rounding", () => {
    expect(solToAtomic("1.000000001")).toBe("1000000001");
    expect(atomicToSol("1000000001")).toBe("1.000000001");
    expect(() => solToAtomic("0.0000000001")).toThrow("9 decimal");
  });

  it("builds the provider-neutral policy accepted by Swig", () => {
    expect(
      policyFromForm(
        [{ chain: "svm", address: "Jupiter" }],
        "1.5",
        "recurring",
        216_000,
      ),
    ).toEqual({
      version: 1,
      rules: [
        {
          type: "allowed_call_target",
          target: { chain: "svm", address: "Jupiter" },
        },
        {
          type: "recurring_native_asset_limit",
          amount: "1500000000",
          window: { unit: "slots", value: 216_000 },
        },
      ],
    });
  });

  it("retries a confirm the backend's RPC node has not caught up with", async () => {
    const lagging = new Error(
      JSON.stringify({ error: "still there", error_code: "role_still_active" }),
    );
    const request = vi
      .fn()
      .mockRejectedValueOnce(lagging)
      .mockResolvedValueOnce({ operation: "revoke" });
    await expect(confirmPolicyRevoke(7, "sig", request, 0)).resolves.toEqual({
      operation: "revoke",
    });
    expect(request).toHaveBeenCalledTimes(2);

    const stale = new Error(
      JSON.stringify({ error: "gone", error_code: "stale_policy_binding" }),
    );
    const refused = vi.fn().mockRejectedValue(stale);
    await expect(confirmPolicyRevoke(7, "sig", refused, 0)).rejects.toBe(stale);
    expect(refused).toHaveBeenCalledTimes(1);
    expect(explainPolicyError(stale)).toContain("changed elsewhere");
  });
});
