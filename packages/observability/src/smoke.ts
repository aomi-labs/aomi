import { createHash, timingSafeEqual } from "node:crypto";

import * as Sentry from "@sentry/node";

import type { AppService } from "./failure";
import { createFailurePipeline } from "./pipeline";
import { getAppSentryRelease } from "./route";

export const APP_SENTRY_SMOKE_HEADER = "x-aomi-sentry-smoke";

export type AppSentrySmokeOptions = {
  service: AppService;
  providedSecret: string | null;
  flushTimeoutMs?: number;
};

export async function runAppSentrySmoke(
  options: AppSentrySmokeOptions,
): Promise<boolean> {
  if (
    !options ||
    (options.service !== "portal" && options.service !== "build")
  ) {
    return false;
  }
  if (
    !isAppSentrySmokeRequestAllowed(options.providedSecret, options.service)
  ) {
    return false;
  }

  const attributes = {
    service: options.service,
    route_family: "/api/build/internal/sentry-smoke",
    operation: "sentry_smoke",
    method: "POST",
    handled: true,
    smoke_test: true,
  };

  createFailurePipeline(options.service).handle({
    source: "local",
    error: new Error("Aomi app server Sentry smoke test"),
    context: {
      routeFamily: "/api/build/internal/sentry-smoke",
      operation: "sentry_smoke",
      method: "POST",
      smokeTest: true,
    },
  });
  try {
    Sentry.withIsolationScope((scope) => {
      scope.setLevel("error");
      scope.setTags(attributes);
      Sentry.logger.error("app.smoke_test", attributes, { scope });
    });
    return await Sentry.flush(boundedFlushTimeout(options.flushTimeoutMs));
  } catch {
    return false;
  }
}

export function isAppSentrySmokeRequestAllowed(
  providedSecret: string | null,
  service: AppService = "portal",
): boolean {
  if (process.env.NODE_ENV !== "production") return false;
  if (process.env.SENTRY_ENABLED !== "1") return false;
  if (process.env.SENTRY_ENVIRONMENT !== "staging") return false;
  if (process.env.SENTRY_SMOKE_ENABLED !== "1") return false;
  if (!process.env.SENTRY_DSN?.trim()) return false;
  if (!getAppSentryRelease(service)) return false;

  const expectedSecret = process.env.SENTRY_SMOKE_SECRET;
  if (
    !expectedSecret ||
    typeof providedSecret !== "string" ||
    !providedSecret
  ) {
    return false;
  }

  const expectedDigest = createHash("sha256").update(expectedSecret).digest();
  const providedDigest = createHash("sha256").update(providedSecret).digest();
  return timingSafeEqual(expectedDigest, providedDigest);
}

function boundedFlushTimeout(value: number | undefined): number {
  if (value === undefined) return 2_000;
  if (!Number.isInteger(value) || value < 100 || value > 5_000) return 2_000;
  return value;
}
