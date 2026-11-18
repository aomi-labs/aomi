import { cn } from "@aomi-labs/widget";
import { CheckCircle2, CircleAlert, Terminal } from "lucide-react";

import { BuildLogo } from "@/components/brand/build-logo";

export default function CliAuthCompletePage({
  searchParams,
}: {
  searchParams: { status?: string | string[] };
}) {
  const failed = searchParams.status === "failed";
  const Icon = failed ? CircleAlert : CheckCircle2;

  return (
    <main className="bg-background text-foreground relative flex min-h-screen items-center justify-center overflow-hidden p-6">
      <div
        aria-hidden="true"
        className="bg-aomi-surface-2 pointer-events-none absolute -top-32 h-72 w-72 rounded-full blur-3xl"
      />
      <section className="border-border bg-card animate-fade-up relative w-full max-w-md overflow-hidden rounded-shell border p-8 text-center shadow-popover">
        <div className="flex justify-center">
          <BuildLogo />
        </div>

        <div
          className={cn(
            "mx-auto mt-8 flex size-14 items-center justify-center rounded-full",
            failed
              ? "bg-aomi-danger/10 text-aomi-danger"
              : "bg-aomi-success/10 text-aomi-success",
          )}
        >
          <Icon aria-hidden="true" className="size-7" />
        </div>

        <p className="text-aomi-muted mt-5 text-xs font-medium uppercase tracking-[0.16em]">
          Aomi Build CLI
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">
          {failed ? "Authorization failed" : "Authorization received"}
        </h1>
        <p className="text-aomi-muted mx-auto mt-3 max-w-sm text-sm leading-6">
          {failed
            ? "Return to your terminal for details, then try signing in again."
            : "Aomi Build will finish signing you in and continue your deployment from the terminal."}
        </p>

        <div className="border-border bg-aomi-surface-2 mt-7 flex items-center justify-center gap-2 rounded-card border px-4 py-3">
          <Terminal aria-hidden="true" className="text-aomi-muted size-4" />
          <span className="text-sm font-medium">Return to your terminal</span>
        </div>
        <p className="text-aomi-muted mt-4 text-xs">This window is safe to close.</p>
      </section>
    </main>
  );
}
