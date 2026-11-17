import type { ReactNode } from "react";

import { UrlLink as Link } from "@/components/url-link";

export const BUTTON =
  "border-border hover:bg-accent-hover inline-flex h-7 items-center rounded-md border px-2.5 text-[12px] font-medium transition disabled:opacity-50";

export function Pill({
  children,
  tone = "muted",
}: {
  children: ReactNode;
  tone?: "muted" | "good" | "warn";
}) {
  const color =
    tone === "good"
      ? "text-emerald-600 border-emerald-600/30"
      : tone === "warn"
        ? "text-amber-600 border-amber-600/30"
        : "text-dim border-border";
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-sm border px-1.5 py-0.5 text-[11px] font-medium ${color}`}
    >
      {children}
    </span>
  );
}

/** A section card. `origin` says where its values come from: the repo, or Build. */
export function Card({
  title,
  origin,
  children,
  footer,
}: {
  title: string;
  origin?: "repo" | "build";
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <section className="border-border bg-surface-1 rounded-lg border">
      <header className="border-border flex items-center justify-between gap-3 border-b px-4 py-2.5">
        <h2 className="text-foreground text-sm font-medium">{title}</h2>
        {origin ? (
          <span className="text-dim text-[11px]">
            {origin === "repo" ? "From the repo" : "Set in Build"}
          </span>
        ) : null}
      </header>
      <div className="divide-border divide-y">{children}</div>
      {footer ? (
        <p className="text-dim border-border border-t px-4 py-2.5 text-[12px]">
          {footer}
        </p>
      ) : null}
    </section>
  );
}

export function Row({
  label,
  hint,
  children,
}: {
  label: ReactNode;
  hint?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-2.5 text-[13px]">
      <div className="min-w-0">
        <div className="text-foreground truncate">{label}</div>
        {hint ? (
          <div className="text-dim truncate text-[12px]">{hint}</div>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-2">{children}</div>
    </div>
  );
}

/** The repository URL a `source_repo` names (`owner/repo` or a full URL). */
export function repoUrl(repo: string): string {
  return /^https?:\/\//.test(repo)
    ? repo.replace(/\/+$/, "")
    : `https://github.com/${repo}`;
}

/**
 * "From aomi.toml at <sha> · Edit in GitHub": where the live release came
 * from. A publish without provenance records no repo or commit; the strip
 * then drops the sha, and without a repo says so in place of the link.
 */
export function SourceStrip({
  repo,
  commit,
  file = "aomi.toml",
}: {
  repo: string | null;
  commit: string | null;
  file?: string;
}) {
  return (
    <p className="text-dim text-[13px]">
      From <span className="font-mono">{file}</span>
      {commit ? (
        <>
          {" "}
          at{" "}
          <span className="text-foreground font-mono">
            {commit.slice(0, 7)}
          </span>
        </>
      ) : null}{" "}
      ·{" "}
      {repo ? (
        <a
          href={`${repoUrl(repo)}/blob/${commit ?? "HEAD"}/${file}`}
          target="_blank"
          rel="noreferrer"
          className="text-foreground font-medium hover:underline"
        >
          Edit in GitHub
        </a>
      ) : (
        "no source recorded"
      )}
    </p>
  );
}

export function PageHeader({
  back,
  title,
  badges,
  summary,
}: {
  back: { href: string; label: string };
  title: string;
  badges?: ReactNode;
  summary?: ReactNode;
}) {
  return (
    <div className="space-y-2">
      <Link href={back.href} className="text-dim text-[12px] hover:underline">
        {back.label} /
      </Link>
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-foreground text-xl font-semibold">{title}</h1>
        {badges}
      </div>
      {summary}
    </div>
  );
}

export function Notice({ children }: { children: ReactNode }) {
  return (
    <div
      role="status"
      className="bg-surface-2 text-foreground rounded-lg px-3 py-2.5 text-[13px]"
    >
      {children}
    </div>
  );
}

export function formatTime(value: string | number): string {
  const date =
    typeof value === "number" ? new Date(value * 1000) : new Date(value);
  return Number.isNaN(date.getTime())
    ? String(value)
    : date.toLocaleString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
}
