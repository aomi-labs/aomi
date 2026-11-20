import type { ReactNode } from "react";
import { Bot, Code, Github, Info, Plug, Sparkles } from "lucide-react";
import { StatusPill } from "@aomi-labs/widget/host-composition";

import { UrlLink as Link } from "@/components/url-link";
import { PageHeader } from "@/components/control-plane/page";

const CARD =
  "border-aomi-border bg-aomi-raised rounded-card flex flex-col gap-2.5 border p-[18px]";

function Choice({
  href,
  icon,
  title,
  body,
  tag,
  first = false,
}: {
  href?: string;
  icon: ReactNode;
  title: string;
  body: string;
  tag: string;
  first?: boolean;
}) {
  const content = (
    <>
      <span
        className={`rounded-control flex size-9 items-center justify-center [&_svg]:size-4 ${first ? "bg-aomi-accent-subtle text-aomi-accent-strong" : "bg-aomi-surface-2 text-aomi-muted"}`}
      >
        {icon}
      </span>
      <span className="type-row">{title}</span>
      <span className="type-control text-aomi-muted">{body}</span>
      <span className="mt-auto flex">
        <StatusPill tone={first ? "accent" : "neutral"}>{tag}</StatusPill>
      </span>
    </>
  );
  if (!href) return <div className={`${CARD} opacity-60`}>{content}</div>;
  const external = href.startsWith("http");
  return external ? (
    <a href={href} target="_blank" rel="noreferrer" className={`${CARD} hover:border-aomi-muted/60`}>
      {content}
    </a>
  ) : (
    <Link href={href} className={`${CARD} hover:border-aomi-muted/60`}>
      {content}
    </Link>
  );
}

/** Where a new package or agent starts. Build holds neither: both live in the repo. */
export function NewView() {
  return (
    <div className="mx-auto flex w-full max-w-[880px] flex-col gap-6 px-4 pb-16 pt-8 sm:px-8">
      <PageHeader
        title="New"
        summary={<p>Make a package, or set up an agent that uses packages.</p>}
      />
      <div className="flex flex-col items-start gap-3">
        <div
          role="tablist"
          aria-label="What to make"
          className="bg-aomi-surface-2 rounded-control inline-flex gap-0.5 p-[3px]"
        >
          <span
            role="tab"
            aria-selected="true"
            className="bg-aomi-raised text-aomi-fg ring-aomi-border inline-flex h-[26px] items-center rounded-md px-[11px] text-[12px] font-medium ring-1"
          >
            Package
          </span>
          <Link
            href="/agents"
            role="tab"
            aria-selected="false"
            className="text-aomi-muted hover:text-aomi-fg inline-flex h-[26px] items-center rounded-md px-[11px] text-[12px] font-medium"
          >
            Agent
          </Link>
        </div>
        <p className="type-control text-aomi-muted">
          A package holds skills and tools. Pick how it gets its tools.
        </p>
        <div className="type-meta text-aomi-muted flex flex-col gap-1">
          <span className="flex items-center gap-2">
            <span className="text-aomi-fg flex w-[72px] shrink-0 items-center gap-1.5 font-medium">
              <Github className="size-3.5" aria-hidden />
              Package
            </span>
            Lives in a GitHub repo. Changes ship by commit and deploy.
          </span>
          <span className="flex items-center gap-2">
            <span className="text-aomi-fg flex w-[72px] shrink-0 items-center gap-1.5 font-medium">
              <Bot className="size-3.5" aria-hidden />
              Agent
            </span>
            Lives in the repo file. Add an [[agents]] table to aomi.toml.
          </span>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Choice
          first
          href="/build"
          icon={<Sparkles />}
          title="Describe it"
          body="Tell Aomi what you want. Review the plan and the files it writes, then release."
          tag="Fastest"
        />
        <Choice
          href="/settings/integrations"
          icon={<Github />}
          title="Import from GitHub"
          body="Connect a repository that already has an aomi.toml file."
          tag="Your code"
        />
        <Choice
          href="https://aomi.dev/docs"
          icon={<Code />}
          title="Start from the template"
          body="A small Rust package with one tool, ready to edit and release."
          tag="Your code"
        />
        <Choice
          icon={<Plug />}
          title="Connect an MCP server"
          body="Point at a server you already run. Aomi lists its tools and calls them."
          tag="Later"
        />
      </div>
      <div className="bg-aomi-surface-2 rounded-control flex items-center gap-2.5 px-3 py-2.5 text-[13px]">
        <Info className="text-aomi-muted size-4 shrink-0" aria-hidden />
        <span className="min-w-0">
          Built with an older SDK? It is already listed under Packages. Upgrade
          it there.
        </span>
        <Link href="/packages" className="ml-auto shrink-0 font-medium">
          Go to Packages
        </Link>
      </div>
    </div>
  );
}
