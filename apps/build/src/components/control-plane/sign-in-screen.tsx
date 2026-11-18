import { Github } from "lucide-react";

import { AomiLogo, AomiMark } from "@/components/brand/aomi-logo";
import { githubSigninUrl } from "@/features/deploy/client";

/** What a signed-out visitor sees in place of the console. */
export function SignInScreen() {
  return (
    <div className="bg-aomi-bg text-aomi-fg flex min-h-screen flex-col">
      <div className="flex px-5 py-4">
        <AomiLogo />
      </div>
      <main className="flex flex-1 flex-col items-center justify-center gap-6 p-6">
        <AomiMark className="size-11" />
        <h1 className="font-display text-center text-[30px] font-normal leading-9 tracking-[-0.02em]">
          What will you build?
        </h1>
        <div className="border-aomi-border bg-aomi-raised rounded-shell shadow-modal w-full max-w-[400px] border">
          <div className="flex flex-col gap-1 px-5 pb-3 pt-5">
            <h2 className="type-title">Sign in to Aomi Build</h2>
            <p className="type-meta text-aomi-muted">
              Publish packages and agents from your GitHub repositories.
            </p>
          </div>
          <div className="flex flex-col gap-3 px-5 pb-5">
            <a
              href={githubSigninUrl}
              className="bg-aomi-fg text-aomi-bg rounded-control type-control flex h-10 items-center justify-center gap-2 font-medium hover:opacity-90"
            >
              <Github className="size-4" aria-hidden />
              Continue with GitHub
            </a>
            <p className="type-meta text-aomi-muted text-center">
              Aomi only reads the repositories you choose. You can change that
              in GitHub at any time.
            </p>
          </div>
        </div>
      </main>
      <footer className="type-meta text-aomi-muted flex justify-center gap-4 p-5">
        <a
          href="https://aomi.dev/docs"
          target="_blank"
          rel="noreferrer"
          className="hover:text-aomi-fg"
        >
          Docs
        </a>
      </footer>
    </div>
  );
}
