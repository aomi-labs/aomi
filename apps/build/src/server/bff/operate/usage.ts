import "@tanstack/react-start/server-only";

import type {
  OperateStatementResult,
  OperateUsageResult,
  UserProject,
} from "@aomi-labs/deploy";
import {
  EXAMPLE_PROJECT,
  exampleStatement,
} from "@/features/operate/fixtures/wire";
import { buildFailures } from "@/server/bff/failures";
import {
  identifyOperateFailure,
  readCache,
  platformProjectIds,
  onPlatform,
  batchScope,
} from "./scope";
import {
  settleBySource,
  nothingRead,
  operateUnavailableResponse,
} from "./fanout";
import { mergedPartnerPayments } from "./payments";

export async function operateUsageRoute(req: Request) {
  try {
    const scope = await batchScope(req);
    if ("response" in scope) return scope.response;
    // Started before the reads below so it overlaps them.
    const sourcesPending = scope.platformProjects();
    const params = new URL(req.url).searchParams;
    const dates = {
      fromDate: params.get("fromDate") ?? undefined,
      toDate: params.get("toDate") ?? undefined,
    };
    const requestedPlatform = params.get("platform") ?? undefined;

    // Account-wide reads go through the manager's batch endpoints — one usage
    // sweep plus one statement sweep — instead of 2×N per-source reads. A
    // single-source view stays on the per-source reads (one call each). The
    // source list resolves alongside, not ahead: it only feeds the dropdown.
    let batch: {
      usage: OperateUsageResult[];
      statements: OperateStatementResult[];
    } | null = null;
    if (scope.projectId === undefined) {
      const [usage, statements] = await Promise.all([
        readCache.usageBatch.get(
          [
            scope.githubUserId,
            requestedPlatform ?? null,
            dates.fromDate ?? null,
            dates.toDate ?? null,
          ],
          () =>
            scope.client.getUserUsage({
              githubUserId: scope.githubUserId,
              ...dates,
            }),
        ),
        readCache.statementsBatch.get(
          [
            scope.githubUserId,
            requestedPlatform ?? null,
            dates.fromDate ?? null,
            dates.toDate ?? null,
          ],
          () =>
            scope.client.getUserStatements({
              githubUserId: scope.githubUserId,
              ...dates,
            }),
        ),
      ]);
      batch = { usage, statements };
    }
    const owned = { ...scope, projects: await sourcesPending };

    let results: OperateUsageResult[];
    let allStatements: OperateStatementResult[];
    if (batch) {
      // The manager batch answers for every platform the account owns; narrow
      // it to the platform this page is scoped to.
      const platformIds = platformProjectIds(owned.projects);
      results = onPlatform(batch.usage, platformIds);
      allStatements = onPlatform(batch.statements, platformIds);
    } else {
      const [usageReads, statementReads] = await Promise.all([
        settleBySource<OperateUsageResult>(
          owned.projects,
          "operate.usage_source",
          (source) =>
            readCache.usage.get(
              [owned.githubUserId, owned.platform, source.id, dates],
              () =>
                owned.client.getUserProjectUsage({
                  githubUserId: owned.githubUserId,
                  projectId: source.id,
                  ...dates,
                }),
            ),
        ),
        settleBySource<OperateStatementResult>(
          owned.projects,
          "operate.usage_statement",
          (source) =>
            readCache.statement.get(
              [owned.githubUserId, owned.platform, source.id, dates],
              () =>
                owned.client.getUserProjectStatement({
                  githubUserId: owned.githubUserId,
                  projectId: source.id,
                  ...dates,
                }),
            ),
        ),
      ]);
      if (nothingRead(owned.projects, usageReads, statementReads)) {
        return operateUnavailableResponse();
      }
      results = usageReads.ok;
      allStatements = statementReads.ok;
    }
    // The statement lives on its own manager endpoint. A backend with
    // `available: false` (statement_entries not migrated) drops out of
    // `statements`; until BE parity lands we serve the example statement
    // instead (flagged `example: true`) so the design ships visible.
    const statements = allStatements.filter((statement) => statement.available);
    const sum = (pick: (s: OperateStatementResult) => number) =>
      statements.reduce((total, statement) => total + pick(statement), 0);
    return Response.json({
      // Every source the account owns, not just the ones this read covered:
      // the filter dropdown is how a user retries a dropped source on its own.
      projects: owned.projects,
      range: results[0]?.range ?? null,
      daily: results.flatMap((result) =>
        result.daily.map((row) => ({
          ...row,
          project: result.project,
          platform: result.platform,
        })),
      ),
      breakdown: results.flatMap((result) =>
        result.breakdown.map((row) => ({
          ...row,
          project: result.project,
          platform: result.platform,
        })),
      ),
      example: statements.length ? undefined : true,
      statement: statements.length
        ? {
            range: statements[0].range,
            summary: {
              grossRevenue: sum((s) => s.summary.grossRevenue),
              platformFees: sum((s) => s.summary.platformFees),
              serviceCharges: sum((s) => s.summary.serviceCharges),
              net: sum((s) => s.summary.net),
            },
            revenue: statements.flatMap((statement) =>
              statement.revenue.map((row) => ({
                ...row,
                project: statement.project,
              })),
            ),
            charges: statements.flatMap((statement) =>
              statement.charges.map((row) => ({
                ...row,
                project: statement.project,
              })),
            ),
            entries: statements
              .flatMap((statement) =>
                statement.entries.map((row) => ({
                  ...row,
                  project: statement.project,
                })),
              )
              .sort(
                (a, b) =>
                  b.day.localeCompare(a.day) ||
                  a.application.localeCompare(b.application),
              ),
            payments: mergedPartnerPayments(
              statements.map((statement) => ({
                project: statement.project as UserProject,
                payments: statement.payments,
              })),
            ),
          }
        : exampleStatement(owned.projects[0] ?? EXAMPLE_PROJECT),
    });
  } catch (err) {
    return buildFailures.handle(
      identifyOperateFailure(req, "operate.usage", err),
    ).response;
  }
}
