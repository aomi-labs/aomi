import "@tanstack/react-start/server-only";

import type { UserProject } from "@aomi-labs/deploy";
import { buildFailures } from "@/server/bff/failures";

// An unbounded fan-out is a thundering herd: an account with 100+ projects fired
// every per-source read at once and saturated the manager's connection pool, so
// most reads timed out waiting to acquire and the page hung on "Loading". Cap
// the wave instead — the pool is the scarce resource, not our event loop.
const SOURCE_FANOUT_LIMIT = 6;

// Beyond this a source is treated as unavailable rather than allowed to hold a
// fan-out slot (and the whole page) open. Comfortably above a healthy read.
const SOURCE_READ_TIMEOUT_MS = 8_000;

// Capping concurrency alone still lets a degraded manager stretch a large
// account over batches × timeout. Bound the whole fan-out too: projects we never
// got to are dropped like any other failure, so the page renders what it has
// instead of stalling. Well under the platform's function timeout.
const SOURCE_FANOUT_BUDGET_MS = 20_000;

async function mapWithLimit<T, R>(
  items: T[],
  limit: number,
  run: (item: T) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const results = new Array<PromiseSettledResult<R>>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      try {
        results[index] = {
          status: "fulfilled",
          value: await run(items[index]),
        };
      } catch (reason) {
        results[index] = { status: "rejected", reason };
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );
  return results;
}

// Losing the race does not cancel the underlying read — it stays in the promise
// cache and can still land for the next request, which is what we want.
function withTimeout<T>(
  load: () => Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  if (ms <= 0) {
    return Promise.reject(new Error(`${label} skipped: fan-out budget spent`));
  }
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    load(),
    new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`${label} timed out after ${ms}ms`)),
        ms,
      );
    }),
  ]).finally(() => clearTimeout(timer));
}

export type Settled<T> = {
  ok: T[];
  /** Source ids this read could not cover (feeds the all-dropped guard). */
  dropped: number[];
};

// Fan out a per-source read and keep only the projects that succeed. One source
// failing — a freshly scaffolded source with no deployed app, or a transient
// backend blip — must not take down the whole operate page; drop it and render
// the healthy projects instead of failing the entire request. Report what was
// lost: a page silently missing most of the account reads as a complete page.
export async function settleBySource<T>(
  projects: UserProject[],
  operation: string,
  run: (source: UserProject) => Promise<T>,
): Promise<Settled<T>> {
  const deadline = Date.now() + SOURCE_FANOUT_BUDGET_MS;
  const settled = await mapWithLimit(projects, SOURCE_FANOUT_LIMIT, (source) =>
    withTimeout(
      () => run(source),
      Math.min(SOURCE_READ_TIMEOUT_MS, deadline - Date.now()),
      `operate read for source ${source.id}`,
    ),
  );
  const ok: T[] = [];
  const dropped: number[] = [];
  settled.forEach((result, index) => {
    const source = projects[index];
    if (result.status === "fulfilled") {
      ok.push(result.value);
    } else {
      if (source) dropped.push(source.id);
      buildFailures.handle({
        source: "launch",
        error: result.reason,
        context: {
          routeFamily: "/api/bff/operate",
          operation,
          method: "GET",
        },
      });
    }
  });
  return { ok, dropped };
}

// The per-source fallback can drop projects; losing every read used to render
// an empty page behind a warning banner (and Usage then swapped in the
// example statement). An outage should look like an outage: fail the request
// and let the view's error state own it. `ok` counts successful reads, not
// rows, so a healthy-but-empty account never trips this; a skipped leg
// (statements past page one) contributes an empty `ok` and is outvoted by
// the leg that ran.
export function nothingRead(
  projects: UserProject[],
  ...reads: Array<{ ok: unknown[] }>
) {
  return projects.length > 0 && reads.every((read) => read.ok.length === 0);
}

export function operateUnavailableResponse() {
  return Response.json(
    { error: "Operate reads are temporarily unavailable — retry shortly." },
    { status: 503 },
  );
}
