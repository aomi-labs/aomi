import { createHash } from "crypto";
import { NextResponse } from "next/server";

import {
  CLI_SESSION_TTL_SECONDS,
  readGitHubCliExchange,
} from "@build/server/cookies/github";

export const runtime = "nodejs";

function codeChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

// POST /api/bff/cli/exchange { code, codeVerifier }
// Exchanges the short-lived loopback code for the persisted CLI bearer.
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    code?: unknown;
    codeVerifier?: unknown;
  };
  if (
    typeof body.code !== "string" ||
    typeof body.codeVerifier !== "string" ||
    body.codeVerifier.length < 43 ||
    body.codeVerifier.length > 128
  ) {
    return NextResponse.json(
      { error: "invalid CLI exchange request" },
      { status: 400 },
    );
  }

  const exchange = await readGitHubCliExchange(body.code);
  if (
    !exchange ||
    codeChallenge(body.codeVerifier) !== exchange.codeChallenge
  ) {
    return NextResponse.json(
      { error: "CLI login code was rejected" },
      { status: 401 },
    );
  }

  return NextResponse.json({
    accessToken: exchange.accessToken,
    tokenType: "Bearer",
    expiresIn: CLI_SESSION_TTL_SECONDS,
    githubLogin: exchange.session.githubLogin,
    githubUserId: exchange.session.githubUserId,
  });
}
