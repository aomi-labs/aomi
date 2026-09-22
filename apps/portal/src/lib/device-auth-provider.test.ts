import { describe, expect, it } from "vitest";

import {
  classifyProviderInitializationFailure,
  normalizeDeviceAuthProvider,
  providerConfigurationFailure,
  requestedDeviceAuthProvider,
} from "./device-auth-provider";
import { DeviceAuthHandoffError } from "./device-auth-handoff";

const configured = {
  paraApiKey: "para-public-key",
  paraEnvironment: "BETA",
  privyAppId: "privy-app",
};

describe("device auth provider selection", () => {
  it("normalizes supported provider names", () => {
    expect(normalizeDeviceAuthProvider(" PARA ")).toBe("para");
    expect(normalizeDeviceAuthProvider("PRIVY")).toBe("privy");
    expect(normalizeDeviceAuthProvider("other")).toBeNull();
  });

  it("only applies the query selection to provider-auth routes", () => {
    const params = new URLSearchParams("provider=para");
    expect(requestedDeviceAuthProvider("/device-auth", params)).toBe("para");
    expect(requestedDeviceAuthProvider("/oauth/device", params)).toBe("para");
    expect(requestedDeviceAuthProvider("/settings", params)).toBeNull();
  });

  it("reports missing public provider configuration without its value", () => {
    expect(
      providerConfigurationFailure("para", {
        ...configured,
        paraApiKey: "",
      }),
    ).toMatchObject({ code: "para_configuration_missing" });
    expect(
      providerConfigurationFailure("privy", {
        ...configured,
        privyAppId: "",
      }),
    ).toMatchObject({ code: "privy_configuration_missing" });
    expect(
      providerConfigurationFailure("para", {
        ...configured,
        paraEnvironment: "staging",
      }),
    ).toMatchObject({ code: "para_configuration_invalid" });
  });

  it("keeps the stable code of a typed handoff failure", () => {
    expect(
      classifyProviderInitializationFailure(
        "para",
        new DeviceAuthHandoffError("provider_account_conflict", 409),
        configured,
      ),
    ).toMatchObject({ code: "provider_account_conflict" });
    expect(
      classifyProviderInitializationFailure(
        "privy",
        new DeviceAuthHandoffError("provider_credential_timeout"),
        configured,
      ),
    ).toMatchObject({ code: "provider_credential_timeout" });
  });

  it("separates Para origin rejection from other initialization failures", () => {
    expect(
      classifyProviderInitializationFailure(
        "para",
        new Error("origin is not allowed"),
        configured,
      ),
    ).toMatchObject({ code: "para_origin_rejected" });
    expect(
      classifyProviderInitializationFailure(
        "para",
        new Error("sdk unavailable"),
        configured,
      ),
    ).toMatchObject({ code: "para_initialization_failed" });
  });
});
