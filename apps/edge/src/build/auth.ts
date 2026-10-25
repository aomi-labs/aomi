import { cookieWriteAllowed } from "../portal/csrf";
import type { BuildContext } from "./context";
import { githubSessionOf, signerFor, visibilityGrantOf } from "./github-auth";
import { bearerOf, type GitHubCliScope, type GitHubSession } from "./session";

export type AuthResult =
  | { session: GitHubSession; visibilityGrant: string | null }
  | { response: Response };

/**
 * Who is calling a Build control-plane route: a CLI bearer with the required
 * scope when the route accepts one, else the GitHub session cookie (writes
 * must come from a trusted origin). Same rules as the Build BFF's `authorize`.
 */
export async function authorize(
  request: Request,
  ctx: BuildContext,
  options: { write?: boolean; cliScope?: GitHubCliScope } = {},
): Promise<AuthResult> {
  if (options.cliScope) {
    const cli = await signerFor(ctx).readCliSession(bearerOf(request), options.cliScope);
    if (cli) return { session: cli, visibilityGrant: null };
  }
  if (options.write && !cookieWriteAllowed(request, ctx.trustedOrigins))
    return { response: Response.json({ error: "Forbidden" }, { status: 403 }) };
  const session = await githubSessionOf(request, ctx);
  return session
    ? { session, visibilityGrant: visibilityGrantOf(request) }
    : { response: Response.json({ error: "not signed in with GitHub" }, { status: 401 }) };
}
