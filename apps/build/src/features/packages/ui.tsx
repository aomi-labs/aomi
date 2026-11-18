import type { ReactNode } from "react";
import { cn } from "@aomi-labs/widget";
import { ListGroup, SectionHeader } from "@aomi-labs/widget/host-composition";
import { Github, Info } from "lucide-react";

/** The kit's text input (h36, r10, 14px). */
export const INPUT =
  "border-aomi-border bg-aomi-raised text-aomi-fg rounded-control h-9 min-w-0 flex-1 border px-3 text-[14px]";

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
 * A section: header (title, count, and where its values come from or an
 * action), a list group of rows, and an optional note under it.
 */
export function Card({
  title,
  count,
  origin,
  action,
  children,
  footer,
}: {
  title: string;
  count?: number;
  origin?: "repo" | "build";
  action?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2">
      <SectionHeader
        as="h2"
        title={title}
        count={count}
        action={
          action ??
          (origin ? (
            <span className="type-meta text-aomi-muted">
              {origin === "repo" ? "From the repo" : "Set in Build"}
            </span>
          ) : null)
        }
      />
      <ListGroup>{children}</ListGroup>
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

/** `1 tool`, `2 tools`. */
export const plural = (count: number, noun: string) =>
  `${count} ${noun}${count === 1 ? "" : "s"}`;

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
