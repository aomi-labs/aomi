import type { ReactNode } from "react";
import { Github } from "lucide-react";
import { GITHUB_SIGNIN_URL } from "@build/features/launch/dashboard";

export function LoadingPanel({ label }: { label: string }) {
  return (
    <div className="flex min-h-[260px] items-center justify-center px-4 py-10 text-center text-sm text-dim">
      {label}
    </div>
  );
}

export function ErrorPanel({ message }: { message: string }) {
  return (
    <div className="flex min-h-[260px] items-center justify-center px-4 py-10 text-center text-sm text-destructive">
      {message}
    </div>
  );
}

export function EmptyPanel({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-[260px] flex-col items-center justify-center gap-2 px-4 py-10 text-center text-sm text-dim">
      {children}
    </div>
  );
}

export function GitHubSignInPanel({ error }: { error?: string | null }) {
  const errorMessage =
    error === "service_auth_forbidden"
      ? "Sign-in isn't available right now. Try again later."
      : error === "exchange_failed"
        ? "GitHub sign-in failed. Try again."
        : error === "invalid_oauth_state"
          ? "Sign-in expired. Try again."
          : error === "identity_unresolved"
            ? "Could not finish GitHub sign-in. Try again."
            : null;

  return (
    <div className="flex min-h-[320px] flex-col items-center justify-center gap-4 px-4 py-10 text-center">
      <div className="flex size-10 items-center justify-center rounded-full border border-border">
        <Github className="size-5" aria-hidden />
      </div>
      <div>
        <div className="text-base font-semibold">Sign in with GitHub</div>
        <div className="mt-1 max-w-md text-sm leading-6 text-dim">
          Deployment history is scoped to repositories connected to your GitHub
          account.
        </div>
      </div>
      {errorMessage && (
        <div className="max-w-xl rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-left text-sm leading-6 text-warning">
          {errorMessage}
        </div>
      )}
      <a
        href={GITHUB_SIGNIN_URL}
        className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:opacity-90"
      >
        Continue with GitHub
      </a>
    </div>
  );
}
