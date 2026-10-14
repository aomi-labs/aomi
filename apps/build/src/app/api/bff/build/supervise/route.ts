import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { superviseOnce } from "@/server/bff/build/supervisor";
import { buildFailures } from "@/server/bff/failures";
import { anonymousBuildAllowed, runCheckerSecret } from "@/server/env";

export const runtime = "nodejs";

/**
 * Supervisor tick — hit this route every minute in deployed envs (Supabase
 * pg_cron on the run store's project; root vercel.json is shared across
 * Vercel projects, so a Vercel Cron there would bleed to landing/portal);
 * the dev server also ticks in-process. Guarded by
 * BUILD_RUN_CHECKER_CRON_SECRET as the Authorization bearer.
 */
export async function GET(req: Request) {
  const secret = runCheckerSecret();
  if (!anonymousBuildAllowed()) {
    if (
      !secret ||
      !timingSafeEqual(
        createHash("sha256")
          .update(req.headers.get("authorization") ?? "")
          .digest(),
        createHash("sha256").update(`Bearer ${secret}`).digest(),
      )
    ) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
  }
  try {
    const actions = await superviseOnce();
    return NextResponse.json({ actions });
  } catch (error) {
    return buildFailures.handle({
      source: "local",
      error,
      response: { status: 500, error: "build_supervision_failed" },
      context: {
        routeFamily: "/api/bff/build/supervise",
        operation: "build.supervisor_request",
        method: req.method,
      },
    }).response;
  }
}
