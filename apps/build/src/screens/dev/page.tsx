import { notFound } from "@tanstack/react-router";
import { UrlLink as Link } from "@/components/url-link";

// Index of the dev harness pages. Dev-only, matching the portal's /dev
// convention (theme-audit, widget-auth-e2e).
//
// NAMING — pick the suffix by what the page actually does:
//   <feature>-preview  real feature components over stubbed fetch fixtures;
//                      flows are interactive without auth or a backend
//   <feature>-mock     pure design sketch, no real components (delete once
//                      the design ships)
//   <feature>-e2e      drives real/live services end to end
//   <feature>-audit    measurement rig (contrast, perf, ...)
// New pages go in this list with the matching suffix.
const HARNESSES = [
  {
    href: "/dev/integrations-preview",
    name: "Integrations preview",
    description:
      "The real Integrations page (Telegram bots: add, edit apps, remove) over in-memory bot fixtures with a light/dark switch.",
  },
  {
    href: "/dev/operate-preview",
    name: "Operate preview",
    description:
      "The real Operate tabs (observability, transactions, usage, logs) plus the app drill-down, served from BFF-shaped fixtures.",
  },
] as const;

export default function DevIndexPage() {
  if (process.env.NODE_ENV === "production") {
    throw notFound();
  }
  return (
    <main className="bg-background min-h-screen">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-10">
        <div className="space-y-3">
          <p className="text-dim text-[12px] uppercase tracking-wide">Dev</p>
          <h1 className="font-display text-foreground text-2xl font-normal tracking-tight">
            Feature harnesses
          </h1>
          <p className="text-subtle max-w-2xl text-sm">
            Fixture-driven previews of real pages — no GitHub session or backend
            needed. Not linked from the product shell.
          </p>
        </div>
        <div className="flex flex-col gap-4">
          {HARNESSES.map((harness) => (
            <Link
              key={harness.href}
              href={harness.href}
              className="border-border bg-surface-1 hover:border-border-hover rounded-md border px-5 py-4 transition-colors"
            >
              <div className="text-foreground text-sm font-medium">
                {harness.name}
              </div>
              <p className="text-dim mt-1 text-xs leading-5">
                {harness.description}
              </p>
              <p className="text-dim mt-2 font-mono text-[11px]">
                {harness.href}
              </p>
            </Link>
          ))}
        </div>
        <div className="space-y-2">
          <p className="text-dim text-[10px] font-semibold uppercase tracking-[0.07em]">
            Naming
          </p>
          <dl className="text-dim space-y-1 text-xs leading-5">
            <div className="flex gap-2">
              <dt className="text-foreground w-36 shrink-0 font-mono text-[11px]">
                &lt;feature&gt;-preview
              </dt>
              <dd>Real components over fixture data — interactive, no auth.</dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-foreground w-36 shrink-0 font-mono text-[11px]">
                &lt;feature&gt;-mock
              </dt>
              <dd>
                Design sketch only, no real components. Delete after ship.
              </dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-foreground w-36 shrink-0 font-mono text-[11px]">
                &lt;feature&gt;-e2e
              </dt>
              <dd>Drives real services end to end.</dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-foreground w-36 shrink-0 font-mono text-[11px]">
                &lt;feature&gt;-audit
              </dt>
              <dd>Measurement rig (contrast, perf, coverage).</dd>
            </div>
          </dl>
        </div>
      </div>
    </main>
  );
}
