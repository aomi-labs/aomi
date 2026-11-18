import type { ReactNode } from "react";
import { cn } from "@aomi-labs/widget";
import { Github, Info } from "lucide-react";

/** The kit's small secondary button (h28, r8, 12px). */
export const BUTTON =
  "border-aomi-border bg-aomi-raised text-aomi-fg hover:border-aomi-muted/60 inline-flex h-7 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-[8px] border px-2.5 text-[12px] font-medium leading-4 shadow-[0_1px_2px_rgba(0,0,0,0.04)] transition-colors disabled:pointer-events-none disabled:opacity-50";

/** The kit's text input (h36, r10, 14px). */
export const INPUT =
  "border-aomi-border bg-aomi-raised text-aomi-fg rounded-control h-9 min-w-0 flex-1 border px-3 text-[14px]";

export type Tone = "neutral" | "accent" | "success" | "warning" | "danger";

const TONE: Record<Tone, string> = {
  neutral: "bg-aomi-surface-2 text-aomi-muted",
  accent: "bg-aomi-accent-subtle text-aomi-accent-strong",
  success: "bg-aomi-success/12 text-aomi-success",
  warning:
    "bg-aomi-warning/15 text-[color-mix(in_srgb,var(--aomi-warning)_62%,var(--aomi-fg))]",
  danger: "bg-aomi-danger/10 text-aomi-danger",
};

/** A status pill: h20, 11px, with an optional dot. */
export function Pill({
  children,
  tone = "neutral",
  dot = false,
}: {
  children: ReactNode;
  tone?: Tone;
  dot?: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-5 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2 text-[11px] font-medium leading-none",
        TONE[tone],
      )}
    >
      {dot ? (
        <span aria-hidden className="size-1.5 rounded-full bg-current" />
      ) : null}
      {children}
    </span>
  );
}

/**
 * A fixed-width trailing cell, so the cells of one list line up as columns.
 * Text and pills sit at the start; `end` pushes an action to the right.
 */
export function Cell({
  width,
  end = false,
  children,
}: {
  width: number;
  end?: boolean;
  children?: ReactNode;
}) {
  return (
    <span
      style={{ width }}
      className={cn(
        "flex shrink-0 items-center",
        end ? "justify-end" : "justify-start",
      )}
    >
      {children}
    </span>
  );
}

/** Mono text for ids, commits and hosts. */
export function Mono({ children }: { children: ReactNode }) {
  return <span className="font-mono text-[11.5px] leading-4">{children}</span>;
}

/**
 * A section: header (title, count, and where its values come from), a list
 * group of rows, and an optional note under it.
 */
export function Card({
  title,
  count,
  origin,
  children,
  footer,
}: {
  title: string;
  count?: number;
  origin?: "repo" | "build";
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex min-h-7 items-center justify-between gap-3 px-0.5">
        <h2 className="type-section">
          {title}
          {count !== undefined ? (
            <span className="text-aomi-muted ml-1 font-normal tabular-nums">
              {count}
            </span>
          ) : null}
        </h2>
        {origin ? (
          <span className="type-meta text-aomi-muted">
            {origin === "repo" ? "From the repo" : "Set in Build"}
          </span>
        ) : null}
      </div>
      <div className="border-aomi-border bg-aomi-raised rounded-card divide-aomi-border divide-y overflow-hidden border">
        {children}
      </div>
      {footer ? (
        <p className="type-meta text-aomi-muted px-0.5">{footer}</p>
      ) : null}
    </section>
  );
}

/** A list row: leading mark, title 14/500 over a 12px line, trailing cells. */
export function Row({
  leading,
  label,
  hint,
  children,
}: {
  leading?: ReactNode;
  label: ReactNode;
  hint?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="relative flex min-h-14 items-center gap-3 px-3.5 py-3">
      {leading}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="type-row truncate">{label}</div>
        {hint ? (
          <div className="type-meta text-aomi-muted truncate">{hint}</div>
        ) : null}
      </div>
      {children}
    </div>
  );
}

/** The one row of an empty list. */
export function EmptyRow({ children }: { children: ReactNode }) {
  return (
    <div className="type-control text-aomi-muted px-3.5 py-3">{children}</div>
  );
}

/** A key/value row: muted label (with an optional line under it), value at the right. */
export function Field({
  label,
  hint,
  children,
}: {
  label: ReactNode;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3 px-3.5 py-2.5 text-[13px] leading-[18px]">
      <div className="min-w-0">
        <div className="text-aomi-muted">{label}</div>
        {hint ? (
          <div className="type-meta text-aomi-muted/80">{hint}</div>
        ) : null}
      </div>
      <div className="text-aomi-fg min-w-0 text-right [overflow-wrap:anywhere]">
        {children}
      </div>
    </div>
  );
}

/** A 32px tile holding an icon or an agent's first letter. */
export function Tile({
  children,
  round = false,
}: {
  children: ReactNode;
  round?: boolean;
}) {
  return (
    <span
      className={cn(
        "flex size-8 shrink-0 items-center justify-center text-[13px] font-semibold [&_svg]:size-4",
        round
          ? "bg-aomi-fg text-aomi-bg rounded-full"
          : "rounded-control bg-aomi-accent-subtle text-aomi-accent-strong",
      )}
    >
      {children}
    </span>
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
    <p className="text-aomi-muted flex flex-wrap items-center gap-x-1.5 text-[13px]">
      <Github className="size-3.5 shrink-0" aria-hidden />
      From <Mono>{file}</Mono>
      {commit ? (
        <>
          at{" "}
          <span className="text-aomi-fg">
            <Mono>{commit.slice(0, 7)}</Mono>
          </span>
        </>
      ) : null}
      <span aria-hidden>·</span>
      {repo ? (
        <a
          href={`${repoUrl(repo)}/blob/${commit ?? "HEAD"}/${file}`}
          target="_blank"
          rel="noreferrer"
          className="text-aomi-fg font-medium hover:underline"
        >
          Edit in GitHub
        </a>
      ) : (
        "no source recorded"
      )}
    </p>
  );
}

/** Two columns: the main sections and a 320px side column that wraps under them. */
export function Columns({ main, side }: { main: ReactNode; side: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start gap-6">
      <div className="flex min-w-0 flex-[999_1_480px] flex-col gap-5">
        {main}
      </div>
      <div className="flex min-w-0 flex-[1_1_320px] flex-col gap-5">{side}</div>
    </div>
  );
}

/** The kit's info strip. */
export function Notice({ children }: { children: ReactNode }) {
  return (
    <div
      role="status"
      className="bg-aomi-surface-2 text-aomi-fg rounded-control flex items-center gap-2.5 px-3 py-2.5 text-[13px]"
    >
      <Info className="text-aomi-muted size-4 shrink-0" aria-hidden />
      <div className="min-w-0">{children}</div>
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
