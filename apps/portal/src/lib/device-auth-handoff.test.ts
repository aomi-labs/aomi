import { describe, expect, it, vi } from "vitest";
import {
  DeviceAuthHandoffError,
  deviceGrantFailure,
  providerExchangeFailure,
  waitForProviderCredential,
} from "./device-auth-handoff";

function clock(start = 0) {
  let now = start;
  return {
    now: () => now,
    sleep: async (ms: number) => {
      now += ms;
    },
  };
}

describe("waitForProviderCredential", () => {
  it("asks for a fresh credential and returns the first one issued", async () => {
    const getCredential = vi
      .fn<(options?: { fresh?: boolean }) => Promise<unknown>>()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ provider: "para", providerToken: "t" });
    const { now, sleep } = clock();

    await expect(
      waitForProviderCredential(getCredential, { now, sleep }),
    ).resolves.toEqual({ provider: "para", providerToken: "t" });
    expect(getCredential).toHaveBeenCalledTimes(3);
    expect(getCredential).toHaveBeenCalledWith({ fresh: true });
  });

  it("outlasts a 30-second provider cooldown", async () => {
    const { now, sleep } = clock();
    const getCredential = vi.fn(async () =>
      now() < 31_000 ? null : { provider: "para", providerToken: "t" },
    );

    await expect(
      waitForProviderCredential(getCredential, { now, sleep }),
    ).resolves.toMatchObject({ providerToken: "t" });
    expect(now()).toBeGreaterThanOrEqual(31_000);
  });

  it("fails with a stable timeout code when nothing is issued", async () => {
    const { now, sleep } = clock();
    const getCredential = vi.fn(async () => null);

    await expect(
      waitForProviderCredential(getCredential, {
        now,
        sleep,
        budgetMs: 5_000,
        intervalMs: 1_000,
      }),
    ).rejects.toMatchObject({
      name: "DeviceAuthHandoffError",
      code: "provider_credential_timeout",
    });
    expect(now()).toBe(5_000);
  });

  it("stops as soon as the caller cancels", async () => {
    const { now, sleep } = clock();
    let cancelled = false;
    const getCredential = vi.fn(async () => {
      cancelled = true;
      return null;
    });

    await expect(
      waitForProviderCredential(getCredential, {
        now,
        sleep,
        isCancelled: () => cancelled,
      }),
    ).rejects.toMatchObject({ code: "provider_login_cancelled" });
    expect(getCredential).toHaveBeenCalledTimes(1);
  });
});

describe("handoff failure mapping", () => {
  it("maps provider exchange statuses onto actionable codes", () => {
    expect(providerExchangeFailure(409).code).toBe("provider_account_conflict");
    expect(providerExchangeFailure(429).code).toBe(
      "provider_exchange_rate_limited",
    );
    expect(providerExchangeFailure(500)).toMatchObject({
      code: "provider_exchange_failed",
      status: 500,
    });
  });

  it("separates login and link grant failures", () => {
    expect(deviceGrantFailure(500, "login").code).toBe("device_grant_failed");
    expect(deviceGrantFailure(400, "link").code).toBe("device_link_failed");
    expect(deviceGrantFailure(429, "link").code).toBe(
      "provider_exchange_rate_limited",
    );
  });

  it("never carries provider or HTTP bodies in its message", () => {
    const error = new DeviceAuthHandoffError("provider_exchange_failed", 502);
    expect(error.message).not.toMatch(/502/);
    expect(error.status).toBe(502);
  });
});
