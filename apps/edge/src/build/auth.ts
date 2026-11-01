import { cookieWriteAllowed } from "@aomi-labs/account/csrf";
import { EdgeError } from "../kernel/errors";
import type { BuildContext } from "./context";
import { githubSessionOf, signerFor, visibilityGrantOf } from "./github-auth";
import { bearerOf, type GitHubCliScope, type GitHubSession } from "@aomi-labs/account/build-session";

export type AuthOptions = { write?: boolean; cliScope?: GitHubCliScope };

/**
 * GitHub user ids of the people who approve app releases: arixoneth, h4n0
 * and CeciliaZ030. Only they may deploy, activate or approve from the CLI;
 * builders use the Build site, and every release they promote waits for one
 * of them.
 */
const APPROVERS = new Set(["61880411", "4738254", "45245961"]);
const APPROVER_CLI_SCOPES: ReadonlySet<GitHubCliScope> = new Set(["deploy", "activate"]);

export function requireApprover(session: GitHubSession): void {
  if (!APPROVERS.has(session.githubUserId))
    throw new EdgeError(403, "only Aomi approvers may do this; builders deploy and promote from the Build site");
}

export type Caller = { session: GitHubSession; visibilityGrant: string | null };

/**
 * Who is calling a Build control-plane route: a CLI bearer with the required
 * scope when the route accepts one, else the GitHub session cookie (writes
 * must come from a trusted origin). Same rules as the Build server's `authorize`.
 */
export async function authorize(request: Request, ctx: BuildContext, options: AuthOptions = {}): Promise<Caller> {
  if (options.cliScope) {
    const cli = await signerFor(ctx).readCliSession(bearerOf(request), options.cliScope);
    if (cli) {
      if (APPROVER_CLI_SCOPES.has(options.cliScope)) requireApprover(cli);
      return { session: cli, visibilityGrant: null };
    }
  }
  if (options.write && !cookieWriteAllowed(request, ctx.trustedOrigins)) throw new EdgeError(403, "forbidden");
  const session = await githubSessionOf(request, ctx);
  if (!session) throw new EdgeError(401, "unauthenticated");
  return { session, visibilityGrant: visibilityGrantOf(request) };
}
