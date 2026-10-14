import { createHash } from "crypto";
import {
  CLI_SESSION_TTL_SECONDS,
  readGitHubCliExchange,
  getGitHubSession,
  getGitHubCliSessionFromRequest,
} from "@/server/cookies/github";
import {
  finishCliAuthorization,
  parseCliLoginRequest,
  startGitHubOAuth,
} from "@/server/github-auth";

function codeChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

// POST /api/bff/cli/exchange { code, codeVerifier }
// Exchanges the short-lived loopback code for the persisted CLI bearer.
export async function cliExchangeRoute(req: Request) {
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
    return Response.json(
      { error: "invalid CLI exchange request" },
      { status: 400 },
    );
  }

  const exchange = await readGitHubCliExchange(body.code);
  if (
    !exchange ||
    codeChallenge(body.codeVerifier) !== exchange.codeChallenge
  ) {
    return Response.json(
      { error: "CLI login code was rejected" },
      { status: 401 },
    );
  }

  return Response.json({
    accessToken: exchange.accessToken,
    tokenType: "Bearer",
    expiresIn: CLI_SESSION_TTL_SECONDS,
    githubLogin: exchange.session.githubLogin,
    githubUserId: exchange.session.githubUserId,
  });
}

// GET /api/bff/cli/login — authorize the CLI from the existing Build browser
// session. Signed-out browsers continue through the one shared GitHub flow.
export async function cliLoginRoute(req: Request) {
  const login = parseCliLoginRequest(new URL(req.url));
  if (!login) {
    return Response.json(
      { error: "invalid CLI login request" },
      { status: 400 },
    );
  }

  const session = await getGitHubSession();
  return session
    ? finishCliAuthorization(session, login)
    : startGitHubOAuth(req, { kind: "cli", ...login });
}

// GET /api/bff/cli/status — validate a saved CLI bearer without exposing it.
export async function cliStatusRoute(req: Request) {
  const session = await getGitHubCliSessionFromRequest(req);
  if (!session) {
    return Response.json({ signedIn: false }, { status: 401 });
  }
  return Response.json({
    signedIn: true,
    githubLogin: session.githubLogin,
    githubUserId: session.githubUserId,
  });
}
