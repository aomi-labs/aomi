import { createHash, randomBytes } from "node:crypto";
import type { PoolClient } from "pg";
import {
  deleteBetterAuthSessions,
  findSignalOwner,
  insertAccountMergeTicket,
  listBetterAuthUserIds,
  logAccountEvent,
  mergeAccountRows,
  previewAccountMerge,
  takeAccountMergeTicket,
  withTransaction,
} from "../db/queries";
import { IDENTITY_SCOPES, type AomiUserId, type SignalRef } from "../types";
import { deleteWidgetSessionsForUser } from "../widget-auth/store";

const MERGE_TICKET_TTL_SECONDS = 10 * 60;

/** The body of a 409 `account_merge_available`, minus the error code. */
export type AccountMergeOffer = {
  ticket: string;
  other: {
    name: string;
    created_at: string;
    chats: number;
    wallets: number;
    credits: string;
    dropped: string[];
  };
};

export type AccountMergeResult =
  | { status: "merged"; moved: { chats: number; wallets: number } }
  | { status: "invalid_ticket" }
  | { status: "payment_in_progress" };

/**
 * Offer to merge `sourceUserId` into the signed-in `targetUserId`. The caller
 * has just verified `credential` (a signature or provider token), and that
 * credential opens the source account, so the ticket is the proof of both.
 */
export async function offerAccountMerge(input: {
  targetUserId: AomiUserId;
  sourceUserId: AomiUserId;
  credential: SignalRef;
}): Promise<AccountMergeOffer | null> {
  const preview = await previewAccountMerge(input);
  if (!preview) return null;
  const ticket = randomBytes(32).toString("base64url");
  await insertAccountMergeTicket({
    id: ticketId(ticket),
    targetUserId: input.targetUserId,
    sourceUserId: input.sourceUserId,
    credential: input.credential,
    expiresAt: Math.floor(Date.now() / 1000) + MERGE_TICKET_TTL_SECONDS,
  });
  return {
    ticket,
    other: {
      name: preview.name ?? "Aomi account",
      created_at: preview.createdAt.toISOString(),
      chats: preview.chats,
      wallets: preview.wallets,
      credits: formatCredits(preview.creditsMicrousd),
      dropped: preview.dropped,
    },
  };
}

/** Merge the ticket's source account into `targetUserId`, which must be the
 * account the ticket was minted for. The source's sessions end. */
export async function mergeAccountWithTicket(input: {
  ticket: string;
  targetUserId: AomiUserId;
}): Promise<AccountMergeResult> {
  try {
    return await withTransaction(async (db) => {
      const source = await takeLiveTicket(input, db);
      if (!source) return { status: "invalid_ticket" as const };
      const moved = await mergeInto(source, input.targetUserId, db);
      return {
        status: "merged" as const,
        moved: { chats: moved.chats, wallets: moved.wallets },
      };
    });
  } catch (error) {
    if (isPaymentInProgress(error)) return { status: "payment_in_progress" };
    throw error;
  }
}

/** Consume the ticket without merging; returns the Better Auth user to sign
 * in as, so this browser opens the other account instead. */
export async function takeMergeSwitchTicket(input: {
  ticket: string;
  targetUserId: AomiUserId;
}): Promise<
  | { status: "switch"; betterAuthUserId: string }
  | { status: "invalid_ticket" }
  | { status: "unavailable" }
> {
  return withTransaction(async (db) => {
    const source = await takeLiveTicket(input, db);
    if (!source) return { status: "invalid_ticket" as const };
    const [betterAuthUserId] = await listBetterAuthUserIds(source, db);
    return betterAuthUserId
      ? { status: "switch" as const, betterAuthUserId }
      : { status: "unavailable" as const };
  });
}

/**
 * A guest signed in with a method that opens `accountUserId`: fold the guest's
 * chats in. A guest has no sign-in method of its own, so there is nothing to
 * confirm. A no-op when the guest has no account row or is that account.
 */
export async function mergeGuestAccount(input: {
  guestBetterAuthUserId: string;
  accountUserId: AomiUserId;
  db?: PoolClient;
}): Promise<void> {
  const run = async (db: PoolClient) => {
    const guest = await findSignalOwner(
      betterAuthSignal(input.guestBetterAuthUserId),
      db,
    );
    if (!guest || guest === input.accountUserId) return;
    await mergeInto(guest, input.accountUserId, db);
  };
  if (input.db) return run(input.db);
  await withTransaction(run);
}

async function takeLiveTicket(
  input: { ticket: string; targetUserId: AomiUserId },
  db: PoolClient,
): Promise<AomiUserId | null> {
  const ticket = await takeAccountMergeTicket({
    id: ticketId(input.ticket),
    targetUserId: input.targetUserId,
    db,
  });
  if (!ticket) return null;
  // The proof only holds while the credential still opens the source.
  const owner = await findSignalOwner(ticket.credential, db);
  return owner === ticket.sourceUserId ? ticket.sourceUserId : null;
}

async function mergeInto(
  sourceUserId: AomiUserId,
  targetUserId: AomiUserId,
  db: PoolClient,
) {
  const sourceSessions = await listBetterAuthUserIds(sourceUserId, db);
  const moved = await mergeAccountRows({ sourceUserId, targetUserId, db });
  await deleteBetterAuthSessions(sourceSessions, db);
  await deleteWidgetSessionsForUser({ userId: sourceUserId, db });
  await logAccountEvent({
    userId: targetUserId,
    actorUserId: targetUserId,
    eventType: "account.merged",
    data: { sourceUserId, ...moved },
    db,
  });
  return moved;
}

function betterAuthSignal(subject: string): SignalRef {
  return {
    type: "identity",
    provider: "better_auth",
    ...IDENTITY_SCOPES.betterAuth,
    subject,
  };
}

function ticketId(ticket: string): string {
  return createHash("sha256").update(ticket).digest("hex");
}

// Matches the widget's credit display: 10,000 micro-USD per credit.
function formatCredits(microusd: number): string {
  return (microusd / 10_000).toLocaleString("en-US", {
    maximumFractionDigits: 4,
  });
}

function isPaymentInProgress(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.includes("account_merge_payment_in_progress")
  );
}
