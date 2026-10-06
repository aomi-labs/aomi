import "server-only";
import { backendUrlFromEnv } from "@aomi-labs/account/backend-url";
import { readAccountAuthEnv } from "@aomi-labs/account/better-auth/env";

/** The portal BFF's settings, read from the environment in one place. */

/** The Rust backend that signs and serves /api. */
export function backendUrl(): string {
  return backendUrlFromEnv(process.env);
}

/** The public agent API behind /v1. */
export function agentApiUrl(): string {
  const configured = process.env.AOMI_AGENT_API_URL?.trim();
  if (configured) {
    const url = absoluteHttpUrl(configured);
    if (!url)
      throw new Error("AOMI_AGENT_API_URL must be an absolute HTTP URL");
    return url;
  }
  if (
    process.env.VERCEL_ENV === "preview" ||
    process.env.VERCEL_ENV === "production"
  )
    throw new Error("AOMI_AGENT_API_URL is required in hosted environments");
  return "http://127.0.0.1:8082";
}

export type DeploymentTier = "development" | "staging" | "production";

/** Which Aomi environment this portal serves, judged by the backend it talks to. */
export function deploymentTier(): DeploymentTier {
  const host = new URL(backendUrl()).hostname;
  if (host === "api.aomi.dev") return "production";
  if (host === "api-staging.aomi.dev") return "staging";
  if (process.env.VERCEL_ENV === "production") return "production";
  if (process.env.VERCEL_ENV === "preview") return "staging";
  return "development";
}

/** Origins whose cookie-carrying requests count as the portal itself. */
export function portalOrigins(): string[] {
  return readAccountAuthEnv(process.env).trustedOrigins;
}

/** Platforms /api/thread/apps is filtered to when the caller names none. */
export function appCatalogPlatforms(): string[] {
  return [
    ...new Set(
      (process.env.APP_CATALOG_PLATFORMS ?? "")
        .split(",")
        .map((platform) => platform.trim())
        .filter(Boolean),
    ),
  ];
}

/** The header the hosting edge overwrites with the client IP (AOMI_CLIENT_IP_HEADER). */
export function clientIpHeader(): string | null {
  return readAccountAuthEnv(process.env).clientIpHeader;
}

/** Telegram bots whose Mini App launches may sign in. */
export function telegramWidgetBotIds(): string[] {
  return (process.env.TELEGRAM_WIDGET_BOT_IDS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => /^\d+$/.test(value));
}

/** Signs Privy custom-auth JWTs for Telegram users. */
export function telegramCustomAuthPrivateKey(): string | undefined {
  return process.env.PRIVY_TELEGRAM_CUSTOM_AUTH_PRIVATE_KEY || undefined;
}

/** Local-only test tools (E2E wallet). Never on Vercel or a production build. */
export function devToolsAllowed(): boolean {
  return (
    !process.env.VERCEL &&
    !process.env.VERCEL_ENV &&
    process.env.NODE_ENV !== "production"
  );
}

function absoluteHttpUrl(value: string | undefined): string | null {
  if (!value?.trim()) return null;
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol)
      ? url.toString().replace(/\/+$/, "")
      : null;
  } catch {
    return null;
  }
}
