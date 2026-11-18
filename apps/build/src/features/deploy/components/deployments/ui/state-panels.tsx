import type { ReactNode } from "react";
import { Github } from "lucide-react";
import { githubSigninUrl } from "@/features/deploy/client";

export function LoadingPanel({ label }: { label: string }) {
  return (
    <div className="text-aomi-muted flex min-h-[260px] items-center justify-center px-4 py-10 text-center text-[14px]">
      {label}
    </div>
  );
}

export function ErrorPanel({ message }: { message: string }) {
  return (
    <div className="text-aomi-danger flex min-h-[260px] items-center justify-center px-4 py-10 text-center text-[14px]">
      {message}
    </div>
  );
}

export function EmptyPanel({ children }: { children: ReactNode }) {
  return (
    <div className="text-aomi-muted flex min-h-[260px] flex-col items-center justify-center gap-2 px-4 py-10 text-center text-[14px]">
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
      <div className="border-aomi-border flex size-10 items-center justify-center rounded-full border">
        <Github className="size-5" aria-hidden />
      </div>
      <div>
        <div className="type-title">Sign in with GitHub</div>
        <div className="text-aomi-muted mt-1 max-w-md text-[14px]">
          Deployment history is scoped to repositories connected to your GitHub
          account.
        </div>
      </div>
      {errorMessage && (
        <div className="border-warning/40 bg-warning/10 text-warning max-w-xl rounded-md border px-3 py-2 text-left text-sm leading-6">
          {errorMessage}
        </div>
      )}
      <a
        href={githubSigninUrl}
        className="bg-aomi-fg text-aomi-bg rounded-control type-control inline-flex h-10 items-center justify-center gap-2 px-4 font-medium hover:opacity-90"
      >
        <Github className="size-4" aria-hidden />
        Continue with GitHub
      </a>
    </div>
  );
}
