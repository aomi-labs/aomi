import { cookieWriteAllowed } from "@aomi-labs/account/csrf";
import { EdgeError } from "../kernel/errors";
import type { BuildContext } from "./context";
import { githubSessionOf, signerFor, visibilityGrantOf } from "./github-auth";
import { bearerOf, type GitHubCliScope, type GitHubSession } from "@aomi-labs/account/build-session";
import { isApiKey, keyGrant, type KeyGrant } from "./api-keys";

export type AuthOptions = { write?: boolean; cliScope?: GitHubCliScope };

/** `key` is set when the caller authenticated with a builder API key. */
export type Caller = { session: GitHubSession; visibilityGrant: string | null; key?: KeyGrant };

/**
 * Who is calling a Build control-plane route: a CLI bearer with the required
 * scope when the route accepts one, else the GitHub session cookie (writes
 * must come from a trusted origin). Same rules as the Build server's `authorize`.
 *
 * A bearer that is an API key is judged as a key and nothing else: an unknown
 * or revoked key is a 401 even beside a valid session cookie. A key names its
 * builder by GitHub user id only, so the session it yields has no login.
 */
export async function authorize(request: Request, ctx: BuildContext, options: AuthOptions = {}): Promise<Caller> {
  const bearer = bearerOf(request);
  if (isApiKey(bearer)) {
    const key = await keyGrant(bearer, ctx.keys);
    return { session: { githubUserId: key.builderId, githubLogin: "" }, visibilityGrant: null, key };
  }
  if (options.cliScope) {
    const cli = await signerFor(ctx).readCliSession(bearer, options.cliScope);
    if (cli) return { session: cli, visibilityGrant: null };
  }
  if (options.write && !cookieWriteAllowed(request, ctx.trustedOrigins)) throw new EdgeError(403, "forbidden");
  const session = await githubSessionOf(request, ctx);
  if (!session) throw new EdgeError(401, "unauthenticated");
  return { session, visibilityGrant: visibilityGrantOf(request) };
}
