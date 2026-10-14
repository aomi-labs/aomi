// @vitest-environment node
import type { PoolClient } from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mergeAccountWithTicket } from "./account-merge";
import {
  findSignalOwner,
  mergeAccountRows,
  takeAccountMergeTicket,
  withTransaction,
} from "../db/queries";

vi.mock("../db/queries", () => ({
  withTransaction: vi.fn(),
  takeAccountMergeTicket: vi.fn(),
  findSignalOwner: vi.fn(),
  listBetterAuthUserIds: vi.fn(async () => []),
  mergeAccountRows: vi.fn(),
  deleteBetterAuthSessions: vi.fn(),
  logAccountEvent: vi.fn(),
}));
vi.mock("../widget-auth/store", () => ({
  deleteWidgetSessionsForUser: vi.fn(),
}));

const input = { ticket: "proof", targetUserId: "target" };
const paymentBusy = new Error("account_merge_payment_in_progress");

describe("account merge billing wait", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetAllMocks();
    vi.mocked(withTransaction).mockImplementation(async (run) =>
      run({} as PoolClient),
    );
    vi.mocked(takeAccountMergeTicket).mockResolvedValue({
      sourceUserId: "source",
      credential: {
        type: "identity",
        provider: "better_auth",
        issuerEnvironment: "global",
        tenantId: "global",
        subject: "source-login",
      },
    });
    vi.mocked(findSignalOwner).mockResolvedValue("source");
    vi.mocked(mergeAccountRows).mockResolvedValue({
      chats: 1,
      wallets: 1,
      dropped: [],
    });
  });
  afterEach(() => vi.useRealTimers());

  it("waits through a billing tick, revalidating the ticket in a fresh transaction", async () => {
    for (let attempt = 0; attempt < 10; attempt++)
      vi.mocked(mergeAccountRows).mockRejectedValueOnce(paymentBusy);
    const merge = mergeAccountWithTicket(input);
    await vi.advanceTimersByTimeAsync(5_000);
    await expect(merge).resolves.toEqual({
      status: "merged",
      moved: { chats: 1, wallets: 1 },
    });
    expect(withTransaction).toHaveBeenCalledTimes(11);
    expect(takeAccountMergeTicket).toHaveBeenCalledTimes(11);
    expect(findSignalOwner).toHaveBeenCalledTimes(11);
  });

  it("stops after eight seconds when billing still holds the lock", async () => {
    vi.mocked(mergeAccountRows).mockRejectedValue(paymentBusy);
    const merge = mergeAccountWithTicket(input);
    await vi.advanceTimersByTimeAsync(8_000);
    await expect(merge).resolves.toEqual({ status: "payment_in_progress" });
    expect(mergeAccountRows).toHaveBeenCalledTimes(17);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not retry unrelated failures", async () => {
    const failure = new Error("database unavailable");
    vi.mocked(mergeAccountRows).mockRejectedValue(failure);
    await expect(mergeAccountWithTicket(input)).rejects.toBe(failure);
    expect(withTransaction).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("stops if the proof is no longer valid while waiting", async () => {
    vi.mocked(mergeAccountRows).mockRejectedValueOnce(paymentBusy);
    vi.mocked(findSignalOwner)
      .mockResolvedValueOnce("source")
      .mockResolvedValue(null);
    const merge = mergeAccountWithTicket(input);
    await vi.advanceTimersByTimeAsync(500);
    await expect(merge).resolves.toEqual({ status: "invalid_ticket" });
    expect(mergeAccountRows).toHaveBeenCalledTimes(1);
  });
});
