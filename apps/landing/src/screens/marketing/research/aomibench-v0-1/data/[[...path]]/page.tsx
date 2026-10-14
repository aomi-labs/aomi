import {Link} from "@tanstack/react-router";
import {AomiLogo} from "../../../../../components/aomi-logo";
import type {ResearchDirectory} from "@/lib/research-directory";
const ROUTE_ROOT = "/research/aomibench-v0-1/data";
function routeHref(segments: string[]) { return segments.length ? `${ROUTE_ROOT}/${segments.map(encodeURIComponent).join("/")}` : ROUTE_ROOT; }
export const metadata = {title: "AomiBench source data | Aomi Labs Research"};
function formatBytes(size: number | null) {
  if (size === null) {
    return "";
  }

  if (size < 1024) {
    return `${size} B`;
  }

  const units = ["KB", "MB", "GB"];
  let value = size / 1024;

  for (const unit of units) {
    if (value < 1024 || unit === "GB") {
      return `${value.toFixed(value < 10 ? 1 : 0)} ${unit}`;
    }

    value /= 1024;
  }

  return `${size} B`;
}

export default function AomiBenchDataPage({segments, entries}: ResearchDirectory) {
  const title =
    segments.length === 0 ? "aombench_v1_data" : segments[segments.length - 1];
  const parentSegments = segments.slice(0, -1);

  return (
    <main className="mx-auto min-h-screen w-full max-w-4xl px-6 py-16 text-foreground">
      <div className="mb-10 flex items-center justify-between gap-4">
        <Link
          to="/research/$slug" params={{slug: "aomibench-v0-1"}}
          className="font-geist text-sm text-stone-500 underline underline-offset-2 hover:text-foreground dark:text-stone-300"
        >
          AomiBench article
        </Link>
        <Link
          to="/" reloadDocument
          aria-label="Aomi home"
          className="flex items-center gap-2 font-serif text-xl font-bold tracking-tight text-foreground"
        >
          <AomiLogo className="text-[14px]" markClassName="h-3.5 w-3.5 dark:invert" />
        </Link>
      </div>

      <h1 className="font-serif text-4xl leading-tight font-normal tracking-tight md:text-5xl">
        {title}
      </h1>
      <p className="font-geist mt-4 text-sm leading-6 text-stone-500 dark:text-stone-300">
        Browse AomiBench v0.1 source data files.
      </p>

      <div className="mt-8 overflow-hidden rounded-2xl border border-stone-200 dark:border-stone-800">
        {segments.length > 0 ? (
          <Link
            to={routeHref(parentSegments)}
            className="font-geist flex items-center justify-between border-b border-stone-200 px-4 py-3 text-sm text-stone-600 hover:bg-stone-50 hover:text-foreground dark:border-stone-800 dark:text-stone-300 dark:hover:bg-stone-900"
          >
            <span>../</span>
            <span>parent</span>
          </Link>
        ) : null}

        {entries.map((entry) => (
          <Link
            key={entry.href}
            to={entry.href} reloadDocument={!entry.isDirectory}
            className="font-geist flex items-center justify-between gap-4 border-b border-stone-200 px-4 py-3 text-sm last:border-b-0 hover:bg-stone-50 dark:border-stone-800 dark:hover:bg-stone-900"
          >
            <span className="min-w-0 truncate">
              {entry.isDirectory ? `${entry.name}/` : entry.name}
            </span>
            <span className="shrink-0 text-xs text-stone-500 dark:text-stone-400">
              {entry.isDirectory ? "directory" : formatBytes(entry.size)}
            </span>
          </Link>
        ))}
      </div>
    </main>
  );
}
