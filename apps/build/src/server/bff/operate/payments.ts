import "@tanstack/react-start/server-only";

import type {
  OperatePaymentProjectResult,
  OperatePartnerPayments,
} from "@aomi-labs/deploy";
import { creditsToUsd } from "@/features/operate/format";
import { buildFailures } from "@/server/bff/failures";
import {
  identifyOperateFailure,
  readCache,
  platformProjectIds,
  onPlatform,
  batchScope,
} from "./scope";

export function mergedPartnerPayments(
  rows: Array<{
    project: OperatePaymentProjectResult["project"];
    payments: OperatePartnerPayments;
  }>,
) {
  const sum = (pick: (summary: OperatePartnerPayments["summary"]) => number) =>
    rows.reduce((total, row) => total + pick(row.payments.summary), 0);
  const eventById = new Map<
    string,
    OperatePartnerPayments["events"][number] & {
      project: OperatePaymentProjectResult["project"];
    }
  >();
  for (const row of rows) {
    for (const event of row.payments.events) {
      const key = `${event.kind}:${event.id}`;
      const existing = eventById.get(key);
      if (!existing) {
        eventById.set(key, { ...event, project: row.project });
      } else if (existing.applicationId !== event.applicationId) {
        // A recipient-bucket settlement can clear fees for apps in multiple
        // projects. It belongs to the beneficiary, not whichever project the
        // BFF happened to merge first.
        existing.application = null;
        existing.applicationId = null;
      }
    }
  }
  const events = [...eventById.values()].sort(
    (a, b) => b.occurredAt - a.occurredAt || b.id.localeCompare(a.id),
  );
  const buckets = [
    ...new Map(
      rows.flatMap((row) =>
        row.payments.buckets.map((bucket) => [bucket.id, bucket]),
      ),
    ).values(),
  ];
  const settlementEvents = events.filter(
    (event) => event.kind === "settlement_confirmed",
  );
  const outstandingCredits = buckets.reduce(
    (total, bucket) => total + bucket.outstandingCredits,
    0,
  );
  return {
    available: rows.some((row) => row.payments.available),
    scope: "recipient_bucket",
    summary: {
      accruedCredits: sum((summary) => summary.accruedCredits),
      accruedUsd: sum((summary) => summary.accruedUsd),
      settledCredits: settlementEvents.reduce(
        (total, event) => total + event.credits,
        0,
      ),
      settledUsd: settlementEvents.reduce(
        (total, event) => total + event.usd,
        0,
      ),
      outstandingCredits,
      outstandingUsd: creditsToUsd(outstandingCredits),
      pricedCalls: sum((summary) => summary.pricedCalls),
      settlements: settlementEvents.length,
    },
    resources: rows.flatMap((row) =>
      row.payments.resources.map((resource) => ({
        ...resource,
        project: row.project,
      })),
    ),
    buckets,
    events,
  };
}

/** Optional ledger card for the observability page; never blocks its snapshot.
 *  The source list is read only to scope the ledger to the selected platform,
 *  in parallel with it and off the same cache the snapshot already warmed. */
export async function operatePaymentsRoute(req: Request) {
  try {
    const scope = await batchScope(req);
    if ("response" in scope) return scope.response;
    const requestedPlatform =
      new URL(req.url).searchParams.get("platform") ?? undefined;
    const { projectId } = scope;
    // The ledger read is account-wide for the same reason the observability
    // batch is; the platform scope is applied to its rows, not to the request.
    const [results, projects] = await Promise.all([
      readCache.paymentsBatch.get(
        [scope.githubUserId, requestedPlatform ?? null, projectId ?? null],
        () =>
          scope.client.getUserPayments({
            githubUserId: scope.githubUserId,
            projectId,
          }),
      ),
      scope.platformProjects(),
    ]);
    return Response.json({
      payments: mergedPartnerPayments(
        onPlatform(results, platformProjectIds(projects)),
      ),
    });
  } catch (err) {
    return buildFailures.handle(
      identifyOperateFailure(req, "operate.payments", err),
    ).response;
  }
}
