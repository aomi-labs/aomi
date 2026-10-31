import { cookieWriteAllowed } from "@aomi-labs/account/csrf";
import { EdgeError } from "../kernel/errors";
import type { BuildContext } from "./context";
import { githubSessionOf, signerFor, visibilityGrantOf } from "./github-auth";
import { bearerOf, type GitHubCliScope, type GitHubSession } from "@aomi-labs/account/build-session";

export type AuthOptions = { write?: boolean; cliScope?: GitHubCliScope };

export type Caller = { session: GitHubSession; visibilityGrant: string | null };

/**
 * Who is calling a Build control-plane route: a CLI bearer with the required
 * scope when the route accepts one, else the GitHub session cookie (writes
 * must come from a trusted origin). Same rules as the Build server's `authorize`.
 */
export async function authorize(request: Request, ctx: BuildContext, options: AuthOptions = {}): Promise<Caller> {
  if (options.cliScope) {
    const cli = await signerFor(ctx).readCliSession(bearerOf(request), options.cliScope);
    if (cli) return { session: cli, visibilityGrant: null };
  }
  if (options.write && !cookieWriteAllowed(request, ctx.trustedOrigins)) throw new EdgeError(403, "forbidden");
  const session = await githubSessionOf(request, ctx);
  if (!session) throw new EdgeError(401, "unauthenticated");
  return { session, visibilityGrant: visibilityGrantOf(request) };
}
