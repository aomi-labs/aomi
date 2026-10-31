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
  policyFromForm,
  solToAtomic,
  toAtomic,
} from "@/account/policy/policy-api";

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

  it("adds token caps after the native limit, sharing its kind and window", () => {
    const usdc = { chain: "svm" as const, address: "USDC" };
    expect(
      policyFromForm(
        [{ chain: "svm", address: "Jupiter" }],
        "1",
        "recurring",
        216_000,
        [{ mint: usdc, amount: "25000000" }],
      ).rules.at(-1),
    ).toEqual({
      type: "recurring_token_asset_limit",
      mint: usdc,
      amount: "25000000",
      window: { unit: "slots", value: 216_000 },
    });
    expect(
      policyFromForm(
        [{ chain: "svm", address: "Jupiter" }],
        "1",
        "lifetime",
        216_000,
        [{ mint: usdc, amount: "1" }],
      ).rules.at(-1),
    ).toEqual({ type: "lifetime_token_asset_limit", mint: usdc, amount: "1" });
    expect(toAtomic("25", 6, "USDC")).toBe("25000000");
    expect(fromAtomic("25000000", 6)).toBe("25");
    expect(() => toAtomic("0.0000001", 6, "USDC")).toThrow("6 decimal");
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
