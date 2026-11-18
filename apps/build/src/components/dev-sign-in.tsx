import { useGitHubSession } from "@/components/control-plane/github-session-context";
import { API_PATHS } from "@/lib/api-paths";

/** Local development only: sign in as the Edge's configured test builder, without GitHub. */
export function DevSignIn() {
  const { account } = useGitHubSession();
  if (!account.devSignIn || account.signedIn) return null;
  return (
    <a
      href={API_PATHS.build.auth.github.devSignIn}
      className="border-aomi-border text-aomi-muted hover:text-aomi-fg rounded-control type-control flex h-10 items-center justify-center border border-dashed"
    >
      Sign in as test builder (local)
    </a>
  );
}
