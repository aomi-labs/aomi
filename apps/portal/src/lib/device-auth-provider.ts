import {
  isDeviceAuthHandoffError,
  type DeviceAuthHandoffCode,
} from "./device-auth-handoff";

export type DeviceAuthProvider = "privy" | "para";

type SearchParams = {
  get(name: string): string | null;
};

export type ProviderConfiguration = {
  paraApiKey: string;
  paraEnvironment?: string;
  privyAppId: string;
};

export type ProviderInitializationFailure = {
  code:
    | "para_configuration_missing"
    | "para_configuration_invalid"
    | "para_origin_rejected"
    | "para_initialization_failed"
    | "privy_configuration_missing"
    | "privy_initialization_failed"
    | DeviceAuthHandoffCode;
  message: string;
};

export function normalizeDeviceAuthProvider(
  value: string | null,
): DeviceAuthProvider | null {
  const normalized = value?.trim().toLowerCase();
  return normalized === "privy" || normalized === "para" ? normalized : null;
}

export function isDeviceAuthRoute(pathname: string): boolean {
  return pathname === "/device-auth" || pathname === "/oauth/device";
}

export function requestedDeviceAuthProvider(
  pathname: string,
  params: SearchParams,
): DeviceAuthProvider | null {
  return isDeviceAuthRoute(pathname)
    ? normalizeDeviceAuthProvider(params.get("provider"))
    : null;
}

export function providerConfigurationFailure(
  provider: DeviceAuthProvider,
  configuration: ProviderConfiguration,
): ProviderInitializationFailure | null {
  if (provider === "para" && !configuration.paraApiKey) {
    return {
      code: "para_configuration_missing",
      message: "Para authentication is not configured for this deployment.",
    };
  }
  const paraEnvironment = configuration.paraEnvironment?.trim();
  if (
    provider === "para" &&
    paraEnvironment &&
    paraEnvironment !== "BETA" &&
    paraEnvironment !== "PROD"
  ) {
    return {
      code: "para_configuration_invalid",
      message: "Para authentication has an invalid environment setting.",
    };
  }
  if (provider === "privy" && !configuration.privyAppId) {
    return {
      code: "privy_configuration_missing",
      message: "Privy authentication is not configured for this deployment.",
    };
  }
  return null;
}

export function classifyProviderInitializationFailure(
  provider: DeviceAuthProvider,
  error: unknown,
  configuration: ProviderConfiguration,
): ProviderInitializationFailure {
  const configurationFailure = providerConfigurationFailure(
    provider,
    configuration,
  );
  if (configurationFailure) return configurationFailure;

  // Handoff failures already carry a stable, secret-safe code and a message
  // with a next step. Everything else stays provider-scoped and generic.
  if (isDeviceAuthHandoffError(error)) {
    return { code: error.code, message: error.message };
  }

  if (provider === "para") {
    const message = error instanceof Error ? error.message.toLowerCase() : "";
    if (
      message.includes("origin") ||
      message.includes("domain") ||
      message.includes("cors") ||
      message.includes("allowlist") ||
      message.includes("not allowed")
    ) {
      return {
        code: "para_origin_rejected",
        message:
          "Para rejected this browser origin. Check the deployment's allowed origins.",
      };
    }
    return {
      code: "para_initialization_failed",
      message: "Para authentication could not start.",
    };
  }

  return {
    code: "privy_initialization_failed",
    message: "Privy authentication could not start.",
  };
}

export function providerFailureText(
  failure: ProviderInitializationFailure,
): string {
  return `${failure.message} (${failure.code})`;
}
