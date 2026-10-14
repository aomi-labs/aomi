import "@tanstack/react-start/server-only";
import { backendUrlFromEnv } from "@aomi-labs/account/backend-url";

import { DEFAULT_DEPLOY_PLATFORM } from "@/lib/deploy-platform";

/** Build's server configuration for its BFF. */

/** The Rust backend the BFF signs for and forwards to. */
export function backendUrl(): string {
  return backendUrlFromEnv(process.env);
}

/** Local runs may use the Build UI and supervisor without GitHub sign-in. */
export function anonymousBuildAllowed(): boolean {
  return (
    process.env.AOMI_BUILD_ALLOW_ANON === "1" &&
    process.env.NODE_ENV !== "production"
  );
}

/** The bearer the scheduled supervisor tick presents. */
export function runCheckerSecret(): string | undefined {
  return process.env.BUILD_RUN_CHECKER_CRON_SECRET || undefined;
}

/** Signs the GitHub session cookies; at least 16 characters. */
export function githubSessionSecret(): string | undefined {
  return process.env.PORTAL_ONLY_SESSION_SECRET?.trim() || undefined;
}

/** Cookies are Secure everywhere except local development. */
export function secureCookies(): boolean {
  return process.env.NODE_ENV === "production";
}

/** Whether this is the production deployment (which GitHub OAuth app to use). */
export function productionDeployment(): boolean {
  return process.env.VERCEL_ENV === "production";
}

/** Local-only helpers such as the dev GitHub session. */
export function devToolsAllowed(): boolean {
  return (
    !process.env.VERCEL &&
    !process.env.VERCEL_ENV &&
    process.env.NODE_ENV !== "production"
  );
}

const DEFAULT_TEMPLATE_REPO = "aomi-labs/playground-example";

export type DeployConfig = {
  platform: string;
  platforms: string[];
  templateRepo: string;
  createdRepoPrivate: boolean;
};

function envString(name: string, fallback: string): string {
  return process.env[name]?.trim() || fallback;
}

function envBoolean(name: string, fallback: boolean): boolean {
  const value = process.env[name]?.trim().toLowerCase();
  if (!value) return fallback;
  return value === "1" || value === "true" || value === "yes";
}

function dedupe(values: string[]): string[] {
  return Array.from(new Set(values));
}

function envJsonOrCommaList(name: string): string[] {
  const raw = process.env[name]?.trim();
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      return dedupe(
        parsed
          .map((value) => (typeof value === "string" ? value.trim() : ""))
          .filter(Boolean),
      );
    }
  } catch {
    // Fall through to comma-separated parsing for Vercel/plain .env ergonomics.
  }

  return dedupe(
    raw
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
}

function deployPlatforms(): string[] {
  const platforms = envJsonOrCommaList("APP_DEPLOY_PLATFORMS");
  return platforms.length > 0 ? platforms : [DEFAULT_DEPLOY_PLATFORM];
}

/** Where Build deploys apps from and to. */
export function deployConfig(): DeployConfig {
  const resolvedPlatforms = deployPlatforms();

  return {
    platform: resolvedPlatforms[0],
    platforms: resolvedPlatforms,
    templateRepo:
      process.env.APP_DEPLOY_TEMPLATE_REPO?.trim() ||
      // Remove when NEXT_PUBLIC_APP_DEPLOY_TEMPLATE_REPO is unset on aomi-build.
      envString("NEXT_PUBLIC_APP_DEPLOY_TEMPLATE_REPO", DEFAULT_TEMPLATE_REPO),
    createdRepoPrivate: envBoolean("APP_DEPLOY_CREATED_REPO_PRIVATE", false),
  };
}
