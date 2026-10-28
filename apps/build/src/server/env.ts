import "@tanstack/react-start/server-only";
import { hosted } from "@aomi-labs/app-kit/platform";
/** Build's server configuration for its BFF. */

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

/** Local-only helpers such as the dev GitHub session. */
export function devToolsAllowed(): boolean {
  return !hosted() && process.env.NODE_ENV !== "production";
}
