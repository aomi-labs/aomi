import { NextResponse } from "next/server";
import {
  widgetPreflight,
  widgetRoute,
} from "@portal/server/widget-auth/response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PrivyCallback = {
  state?: unknown;
  access_token?: unknown;
  user_id?: unknown;
  wallets?: unknown;
};

function backendBaseUrl(): string {
  const configured =
    process.env.AOMI_PROXY_BACKEND_URL ??
    process.env.BACKEND_URL ??
    process.env.NEXT_PUBLIC_BACKEND_URL;
  if (configured) {
    try {
      return new URL(configured).toString();
    } catch {
      // A browser-relative URL cannot be used for the server-side callback.
    }
  }
  if (process.env.VERCEL_ENV === "production") return "https://api.aomi.dev";
  if (process.env.VERCEL_ENV === "preview")
    return "https://api-staging.aomi.dev";
  return "http://127.0.0.1:8080";
}

function isCallback(
  value: PrivyCallback | null,
): value is Required<PrivyCallback> {
  return Boolean(
    value &&
    typeof value.state === "string" &&
    typeof value.access_token === "string" &&
    typeof value.user_id === "string" &&
    Array.isArray(value.wallets),
  );
}

export const POST = widgetRoute(async (req: Request) => {
  const body = (await req.json().catch(() => null)) as PrivyCallback | null;
  if (!isCallback(body)) {
    return NextResponse.json(
      { error: "invalid_privy_callback" },
      { status: 400 },
    );
  }

  try {
    const upstream = await fetch(
      new URL("/api/auth/privy/callback", backendBaseUrl()),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        cache: "no-store",
      },
    );
    if (!upstream.ok) {
      return NextResponse.json(
        { error: "privy_delegation_rejected" },
        { status: upstream.status },
      );
    }
    return NextResponse.json({ status: "connected" });
  } catch (error) {
    console.error("Privy delegation callback upstream failed", {
      message: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: "privy_delegation_unavailable" },
      { status: 502 },
    );
  }
}, "Privy delegation callback");

// The Mini App calls this BFF route from a different origin. Without the
// explicit preflight, the browser accepts the automatic 204 but refuses to
// send the callback POST, leaving Privy's signer installed without recording
// the matching Aomi signing delegation.
export const OPTIONS = widgetPreflight(["POST", "OPTIONS"]);
