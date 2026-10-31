import "@tanstack/react-start/server-only";

import { cookieWriteAllowed } from "@aomi-labs/account/csrf";
import { anonymousBuildAllowed } from "@/server/env";
import {
  type GitHubCliScope,
  type GitHubSession,
  getGitHubCliSessionFromRequest,
  getGitHubSession,
} from "@/server/cookies/github";

type AuthResult =
  | { session: GitHubSession; visibilityGrant: string | null }
  | { response: Response };
type AnonymousAuthResult =
  | { session: GitHubSession | null }
  | { response: Response };

function visibilityGrantFromRequest(req: Request): string | null {
  const cookie = req.headers.get("cookie") ?? "";
  const value = cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith("aomi_github_visibility="))
    ?.slice("aomi_github_visibility=".length)
    ?.trim();
  return value || null;
}

export function authorize(
  req: Request,
  options: { write?: boolean; cliScope?: GitHubCliScope; allowAnon: true },
): Promise<AnonymousAuthResult>;
export function authorize(
  req: Request,
  options?: { write?: boolean; cliScope?: GitHubCliScope },
): Promise<AuthResult>;
export async function authorize(
  req: Request,
  options: {
    write?: boolean;
    cliScope?: GitHubCliScope;
    allowAnon?: boolean;
  } = {},
): Promise<AuthResult | AnonymousAuthResult> {
  if (options.cliScope) {
    const cli = await getGitHubCliSessionFromRequest(req, options.cliScope);
    if (cli) return { session: cli, visibilityGrant: null };
  }
  if (options.write && !cookieWriteAllowed(req)) {
    return {
      response: Response.json({ error: "Forbidden" }, { status: 403 }),
    };
  }
  const session = await getGitHubSession();
  if (!session && options.allowAnon && anonymousBuildAllowed()) {
    return { session: null };
  }
  return session
    ? { session, visibilityGrant: visibilityGrantFromRequest(req) }
    : {
        response: Response.json(
          { error: "not signed in with GitHub" },
          { status: 401 },
        ),
      };
}
