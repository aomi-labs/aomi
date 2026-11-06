import {
  keccak256,
  parseTransaction,
  recoverTransactionAddress,
  serializeTransaction,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isParaTransactionSigner,
  paraUnsignedTransaction,
  ParaSigningIncompleteError,
  PARA_REVIEW_TIMEOUT_MS,
  PARA_SIGNATURE_GRACE_MS,
  signParaTransaction,
  type ParaTransactionSigningClient,
} from "./para-transaction-signing";

const account = privateKeyToAccount(`0x${"11".repeat(32)}`);
const other = privateKeyToAccount(`0x${"22".repeat(32)}`);
// Victor's approval: approve(0x7777…00ee, 15000) on Arc's USDC.
const APPROVE =
  "0x095ea7b300000000000000000000000077777777dcc4d5a8b6e418fd04d8997ef11000ee0000000000000000000000000000000000000000000000000000000000003a98";

const payload = (chainId: number, nonce = 0) => ({
  kind: "evm_transaction" as const,
  chain_id: chainId,
  nonce,
  signer: account.address,
  transaction: {
    to: "0x3600000000000000000000000000000000000000",
    data: APPROVE,
    value: "0",
    gas_limit: 84325,
    max_fee_per_gas: "45075100000",
    max_priority_fee_per_gas: "5075100000",
  },
});

/** A Para client that signs the RLP it is given with `signer`. */
function para(
  overrides: Partial<ParaTransactionSigningClient> = {},
  signer = account,
): ParaTransactionSigningClient {
  return {
    wallets: { w1: { id: "w1", address: account.address, type: "EVM" } },
    signTransaction: vi.fn(async ({ rlpEncodedTxBase64 }) => ({
      signature: await signer.sign({
        hash: keccak256(
          `0x${Buffer.from(rlpEncodedTxBase64, "base64").toString("hex")}`,
        ),
      }),
    })),
    ...overrides,
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("Para commit transaction signing", () => {
  it.each([
    ["Arc", 5042],
    ["Arc Testnet", 5042002],
  ])(
    "signs the exact prepared %s transaction with its pinned nonce",
    async (_, chainId) => {
      const client = para();
      const signed = await signParaTransaction(client, payload(chainId, 7), {
        onReviewUrl: () => {},
      });
      const parsed = parseTransaction(signed);
      expect(parsed).toMatchObject({
        chainId,
        nonce: 7,
        to: "0x3600000000000000000000000000000000000000",
        data: APPROVE,
        gas: BigInt(84325),
      });
      await expect(
        recoverTransactionAddress({
          serializedTransaction: signed as `0x02${string}`,
        }),
      ).resolves.toBe(account.address);
      expect(client.signTransaction).toHaveBeenCalledWith(
        expect.objectContaining({ walletId: "w1", chainId: String(chainId) }),
      );
    },
  );

  it("hands Para's review page to the caller instead of opening a popup", async () => {
    const open = vi.spyOn(window, "open");
    const reviews: Array<{ url: string } | null> = [];
    const client = para({
      signTransaction: vi.fn(async (args) => {
        args.onTransactionReviewUrl?.("https://app.getpara.com/txReview/p1");
        // Approved on Para's page; Para's own loop then returns the signature.
        return para().signTransaction!(args);
      }),
    });
    await signParaTransaction(client, payload(5042), {
      onReviewUrl: (review) => reviews.push(review),
    });
    expect(open).not.toHaveBeenCalled();
    expect(reviews).toEqual([
      { url: "https://app.getpara.com/txReview/p1" },
      null,
    ]);
  });

  it("bounds a Para request that never settles, as unknown and unbroadcast", async () => {
    vi.useFakeTimers();
    let canceled: (() => boolean) | undefined;
    const client = para({
      signTransaction: vi.fn((args) => {
        canceled = args.isCanceled;
        return new Promise<never>(() => {});
      }),
    });
    const reviews: Array<{ url: string } | null> = [];
    const signing = signParaTransaction(client, payload(5042), {
      onReviewUrl: (review) => reviews.push(review),
    });
    const outcome = expect(signing).rejects.toMatchObject({
      name: "ParaSigningIncompleteError",
      reason: "timeout",
      outcome: "unknown",
      message: expect.stringContaining("at most one can go through"),
    });
    await vi.advanceTimersByTimeAsync(PARA_REVIEW_TIMEOUT_MS + 30_000);
    expect(canceled?.()).toBe(true);
    await vi.advanceTimersByTimeAsync(PARA_SIGNATURE_GRACE_MS);
    await outcome;
    // Para's polling loop is told to stop, and the review prompt is cleared.
    expect(canceled?.()).toBe(true);
    expect(reviews).toEqual([null]);
  });

  it("keeps a signature Para finishes just after being told to stop", async () => {
    // Para saw the approval right before the stop flag and is still in its
    // MPC signing round: that signature is real and must not be dropped.
    vi.useFakeTimers();
    let finish: (() => void) | undefined;
    const client = para({
      signTransaction: vi.fn(
        (args) =>
          new Promise<{ signature?: string }>((resolve) => {
            finish = () => resolve(para().signTransaction!(args));
          }),
      ),
    });
    const signing = signParaTransaction(client, payload(5042, 3), {
      onReviewUrl: () => {},
    });
    await vi.advanceTimersByTimeAsync(PARA_REVIEW_TIMEOUT_MS + 30_000);
    finish!();
    await vi.advanceTimersByTimeAsync(1);
    const signed = await signing;
    expect(parseTransaction(signed).nonce).toBe(3);
  });

  it("keeps Para's pending review id when its review times out", async () => {
    const client = para({
      signTransaction: vi.fn(async () => {
        throw Object.assign(new Error("transaction review has timed out"), {
          name: "TransactionReviewTimeout",
          pendingTransactionId: "pending-1",
        });
      }),
    });
    const error = await signParaTransaction(client, payload(5042), {
      onReviewUrl: () => {},
    }).catch((e) => e);
    expect(error).toBeInstanceOf(ParaSigningIncompleteError);
    expect(error).toMatchObject({
      reason: "timeout",
      pendingTransactionId: "pending-1",
    });
  });

  it("does not read Para's 'denied' as a user rejection", async () => {
    // Para throws TransactionReviewDenied for any failed status read,
    // network errors included, so it is not authoritative.
    const client = para({
      signTransaction: vi.fn(async () => {
        throw Object.assign(new Error("denied"), {
          name: "TransactionReviewDenied",
        });
      }),
    });
    const error = await signParaTransaction(client, payload(5042), {
      onReviewUrl: () => {},
    }).catch((e) => e);
    expect(error).toMatchObject({ reason: "provider_error" });
    expect((error as { code?: number }).code).not.toBe(4001);
  });

  it("refuses a signature from another wallet", async () => {
    await expect(
      signParaTransaction(para({}, other), payload(5042), {
        onReviewUrl: () => {},
      }),
    ).rejects.toThrow("different wallet");
  });

  it("a retry after an unknown outcome signs the same nonce, so only one can land", async () => {
    const first = await signParaTransaction(para(), payload(5042, 0), {
      onReviewUrl: () => {},
    });
    const retry = await signParaTransaction(para(), payload(5042, 0), {
      onReviewUrl: () => {},
    });
    // Same sender, same nonce: the chain accepts at most one of them.
    expect(parseTransaction(first).nonce).toBe(0);
    expect(parseTransaction(retry).nonce).toBe(0);
    await expect(
      recoverTransactionAddress({
        serializedTransaction: retry as `0x02${string}`,
      }),
    ).resolves.toBe(account.address);
    // Both sign exactly the prepared transaction, nothing re-derived.
    const unsigned = serializeTransaction(
      paraUnsignedTransaction(payload(5042, 0)),
    );
    expect(para().signTransaction).toBeDefined();
    expect(first.startsWith("0x02")).toBe(true);
    expect(unsigned.startsWith("0x02")).toBe(true);
  });

  it("recognises only Para wallets that can sign transactions", () => {
    expect(isParaTransactionSigner(para(), account.address)).toBe(true);
    expect(isParaTransactionSigner(para(), other.address)).toBe(false);
    expect(
      isParaTransactionSigner(
        para({ signTransaction: undefined }),
        account.address,
      ),
    ).toBe(false);
  });
});
