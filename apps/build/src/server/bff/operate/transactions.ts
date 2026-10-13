import "@tanstack/react-start/server-only";

import type {
  OperateStatementResult,
  OperateTransactionCursor,
  OperateTransactionsResult,
  UserProject,
  UserTransactionsResult,
} from "@aomi-labs/deploy";
import { caipChainId, caipChainLabel } from "@/features/operate/format";
import { buildFailures } from "@/server/bff/failures";
import {
  identifyOperateFailure,
  readCache,
  platformProjectIds,
  onPlatform,
  batchScope,
} from "./scope";
import {
  type Settled,
  settleBySource,
  nothingRead,
  operateUnavailableResponse,
} from "./fanout";
import {
  pageLimit,
  type CompositeCursor,
  parseCompositeCursor,
  sourceCursor,
  mergedNextCursor,
} from "./cursor";
import { mergedPartnerPayments } from "./payments";

function transactionCursorFor(row: {
  createdAt: number;
  id: string;
}): OperateTransactionCursor {
  return { createdAt: row.createdAt, id: row.id };
}

export async function operateTransactionsRoute(req: Request) {
  try {
    const scope = await batchScope(req);
    if ("response" in scope) return scope.response;
    // Started before the reads below so it overlaps them.
    const sourcesPending = scope.platformProjects();
    const params = new URL(req.url).searchParams;
    const limit = pageLimit(params, 50, 100);
    const cursor = parseCompositeCursor(params.get("cursor"));
    const status = params.get("status") ?? undefined;
    const requestedPlatform = params.get("platform") ?? undefined;

    // Account-wide reads go through the manager's batch endpoints: one merged
    // transactions page plus one statement sweep, instead of 2×N per-source
    // reads that saturated the manager on large accounts. Without an explicit
    // `platform`, the manager resolves each source under its own bound/loaded
    // platform, which also covers partner-bound projects. A single-source view
    // stays on the per-source reads — one call each, and the cursor there is
    // per-source anyway.
    //
    // The source list resolves alongside them rather than ahead of them: it
    // only feeds the filter dropdown, so making the page's real reads wait on
    // it added a whole manager round trip to first paint.
    let batch: {
      page: UserTransactionsResult;
      statements: OperateStatementResult[];
    } | null = null;
    if (scope.projectId === undefined) {
      const [page, statements] = await Promise.all([
        readCache.transactionsBatch.get(
          [
            scope.githubUserId,
            requestedPlatform ?? null,
            { limit, status, cursor: cursor?.batch ?? null },
          ],
          () =>
            scope.client.listUserTransactions({
              githubUserId: scope.githubUserId,
              limit,
              status,
              cursor: (cursor?.batch ?? undefined) as
                | OperateTransactionCursor
                | undefined,
            }),
        ),
        cursor
          ? Promise.resolve([] as OperateStatementResult[])
          : readCache.statementsBatch.get(
              [scope.githubUserId, requestedPlatform ?? null, null, null],
              () =>
                scope.client.getUserStatements({
                  githubUserId: scope.githubUserId,
                }),
            ),
      ]);
      batch = { page, statements };
    }
    const owned = { ...scope, projects: await sourcesPending };

    let appTransactions: Array<Record<string, any>>;
    let statements: OperateStatementResult[];
    let nextCursor: CompositeCursor | null;
    if (batch) {
      const sourceById = new Map(
        batch.page.projects.map((ref) => [ref.project.id, ref.project]),
      );
      // The manager batch answers for every platform the account owns; narrow
      // it to the platform this page is scoped to before anything is rendered.
      const platformIds = platformProjectIds(owned.projects);
      appTransactions = onPlatform(
        batch.page.transactions.map(
          ({ projectId, platform, ...transaction }) => ({
            ...transaction,
            kind: "app_transaction",
            project:
              (projectId != null ? sourceById.get(projectId) : undefined) ??
              null,
            platform: platform ?? owned.platform,
          }),
        ),
        platformIds,
      );
      statements = onPlatform(batch.statements, platformIds);
      nextCursor = batch.page.nextCursor
        ? { batch: batch.page.nextCursor }
        : null;
    } else {
      const [transactionReads, statementReads] = await Promise.all([
        settleBySource<OperateTransactionsResult>(
          owned.projects,
          "operate.transactions_source",
          (source) =>
            readCache.transactions.get(
              [
                owned.githubUserId,
                owned.platform,
                source.id,
                { limit, status, cursor: sourceCursor(cursor, source.id) },
              ],
              () =>
                owned.client.listUserProjectTransactions({
                  githubUserId: owned.githubUserId,
                  projectId: source.id,
                  limit,
                  status,
                  cursor: sourceCursor(cursor, source.id) as
                    | OperateTransactionCursor
                    | string
                    | undefined,
                }),
            ),
        ),
        cursor
          ? Promise.resolve({
              ok: [],
              dropped: [],
            } as Settled<OperateStatementResult>)
          : settleBySource<OperateStatementResult>(
              owned.projects,
              "operate.transactions_statement",
              (source) =>
                readCache.statement.get(
                  [owned.githubUserId, owned.platform, source.id, null],
                  () =>
                    owned.client.getUserProjectStatement({
                      githubUserId: owned.githubUserId,
                      projectId: source.id,
                    }),
                ),
            ),
      ]);
      if (nothingRead(owned.projects, transactionReads, statementReads)) {
        return operateUnavailableResponse();
      }
      const results = transactionReads.ok;
      appTransactions = results
        .flatMap((result) =>
          result.transactions.map((transaction) => ({
            ...transaction,
            kind: "app_transaction",
            project: result.project,
            platform: result.platform,
          })),
        )
        .sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id));
      statements = statementReads.ok;
      nextCursor = mergedNextCursor(
        cursor,
        appTransactions.slice(0, limit) as Array<{
          project: { id: number };
          createdAt: number;
          id: string;
        }>,
        appTransactions as Array<{
          project: { id: number };
          createdAt: number;
          id: string;
        }>,
        results,
        transactionCursorFor,
      );
    }
    const payments = mergedPartnerPayments(
      statements.map((statement) => ({
        project: statement.project as UserProject,
        payments: statement.payments,
      })),
    );
    const payouts =
      params.get("status") && params.get("status") !== "confirmed"
        ? []
        : payments.events
            .filter((event) => event.kind === "settlement_confirmed")
            .map((event) => {
              const provider =
                event.paymentMethod.toLowerCase() === "coinbase"
                  ? "Coinbase"
                  : event.paymentMethod;
              return {
                id: `partner-payout:${event.id}`,
                kind: "partner_payout",
                externalTxId: event.receiptId ?? event.id,
                application: event.application ?? "Partner payout",
                applicationId: event.applicationId,
                status: "confirmed",
                txHash: event.receiptId,
                chainId: caipChainId(event.chain),
                fromAddress: "",
                toAddress: event.recipient,
                value: `${event.assetAmount ?? event.usd} ${event.asset ?? "USD"}`,
                hasCalldata: false,
                calldataPreview: null,
                description: `Partner settlement via ${provider}`,
                createdAt: event.occurredAt,
                updatedAt: event.occurredAt,
                submittedAt: event.occurredAt,
                family: "evm",
                chainName: caipChainLabel(event.chain) || null,
                fromLabel: null,
                toLabel: "beneficiary",
                valueUsd: `$${event.usd.toFixed(2)}`,
                block: null,
                slot: null,
                confirmations: null,
                gasUsed: null,
                gasLimit: null,
                effGasPrice: null,
                computeUnits: null,
                computeLimit: null,
                priorityFee: null,
                txFee: null,
                platformFee: null,
                nonce: null,
                method: provider === "Coinbase" ? "Coinbase x402" : provider,
                transfers: [],
                revertReason: null,
                explorerUrl: event.explorerUrl,
                payment: {
                  credits: event.credits,
                  recipient: event.recipient,
                  scope: payments.scope,
                },
                project: event.project,
                platform: owned.platform,
              };
            });
    // Statement-backed payouts have no transaction cursor. Include the full
    // deduplicated overlay on page one, alongside one normal page of app
    // transactions, so an older settlement cannot be sliced out forever.
    const visibleAppTransactions = appTransactions.slice(0, limit);
    const transactions = [...visibleAppTransactions, ...payouts].sort(
      (a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id),
    );
    return Response.json({
      // Every source the account owns, not just the ones this read covered:
      // the filter dropdown is how a user loads one source on its own.
      projects: owned.projects,
      transactions,
      nextCursor,
    });
  } catch (err) {
    return buildFailures.handle(
      identifyOperateFailure(req, "operate.transactions", err),
    ).response;
  }
}
