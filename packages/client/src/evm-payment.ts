import {
  decodeEventLog,
  encodeFunctionData,
  erc20Abi,
  formatUnits,
  getAddress,
  parseUnits,
  type Hex,
} from "viem";
import type { CommitView } from "./commits";
import { reviewEligibility } from "./commit-lifecycle";
import { asRecord } from "./internal/record";

export type EvmPaymentAsset = {
  chainId: number;
  token: string;
  decimals: number;
};
export type EvmPaymentIntent = {
  asset: EvmPaymentAsset;
  /** Set after funding selection; required when reconciling a payment Commit. */
  sender?: string;
  recipient: string;
  amount: string;
};
export type EvmFundingSource = {
  address: string;
  role: "operational" | "treasury" | "development" | "third_party";
  asset: EvmPaymentAsset;
  rpcUrl: string;
};
export type EvmFundingSnapshot = {
  source: Omit<EvmFundingSource, "rpcUrl">;
  state:
    | "funded"
    | "insufficient_token"
    | "insufficient_gas"
    | "route_required"
    | "not_operational"
    | "unavailable";
  blockNumber: string | null;
  balance: string | null;
  nativeBalance: string | null;
  /** Estimated native gas budget in base units, including a 2x gas-price buffer. */
  nativeGasBudget: string | null;
  /** Destination-token units; null when a conversion quote is still needed. */
  shortfall: string | null;
};
export type EvmPaymentFunding = {
  payment: EvmPaymentIntent;
  sources: EvmFundingSnapshot[];
  selected: EvmFundingSnapshot["source"] | null;
  routeFees: "not_applicable" | "unquoted";
};
export type EvmPaymentStatus = {
  commitId: string;
  commitState: CommitView["state"];
  phase:
    | "awaiting_signature"
    | "signed"
    | "submitted"
    | "checking_submission"
    | "payment_completed"
    | "verification_pending"
    | "verification_failed"
    | "failed"
    | "rejected"
    | "expired";
  simulation: string;
  transactionId: string | null;
  canRequestSignature: boolean;
  receipt: "unknown" | "pending" | "confirmed" | "reverted";
  recipient: "unverified" | "verified";
  balanceBefore: string | null;
  balanceAfter: string | null;
  balanceDelta: string | null;
  reason?: string;
};

function asset(input: EvmPaymentAsset): EvmPaymentAsset {
  if (
    !Number.isSafeInteger(input?.chainId) ||
    input.chainId <= 0 ||
    !Number.isInteger(input.decimals) ||
    input.decimals < 0 ||
    input.decimals > 255
  )
    throw new Error(
      "Payment asset requires a chain ID, token contract and valid decimals",
    );
  return {
    chainId: input.chainId,
    token: getAddress(input.token),
    decimals: input.decimals,
  };
}
function sameAddress(left: unknown, right: string) {
  return typeof left === "string" && left.toLowerCase() === right.toLowerCase();
}
function quantity(input: unknown): bigint {
  if (typeof input !== "string" || !/^0x[0-9a-f]+$/i.test(input))
    throw new Error("Invalid RPC quantity");
  return BigInt(input);
}
function units(amount: string, decimals: number): bigint {
  if (
    typeof amount !== "string" ||
    !/^\d+(?:\.\d+)?$/.test(amount) ||
    (amount.split(".")[1]?.length ?? 0) > decimals
  )
    throw new Error(
      "Payment amount must be an exact positive decimal without rounding",
    );
  const value = parseUnits(amount, decimals);
  if (value <= BigInt(0) || value >= BigInt(2) ** BigInt(256))
    throw new Error("Payment amount is outside the token range");
  return value;
}

/** Explicit, read-only chain access. RPC credentials and response bodies never enter reports. */
class PaymentRpc {
  constructor(
    private chainId: number,
    private url: string,
    private fetch: typeof globalThis.fetch,
  ) {
    if (!["https:", "http:"].includes(new URL(url).protocol))
      throw new Error("Payment RPC requires HTTP or HTTPS");
  }
  async read(method: string, params: unknown[]): Promise<unknown> {
    let response: Response;
    try {
      response = await this.fetch(this.url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        signal: AbortSignal.timeout(20_000),
      });
    } catch {
      throw new Error("Payment RPC is unavailable");
    }
    if (!response.ok)
      throw new Error(`Payment RPC failed with HTTP ${response.status}`);
    const body = asRecord(await response.json());
    if (!body || body.error || !("result" in body))
      throw new Error("Payment RPC returned an invalid result");
    return body.result;
  }
  async checkChain() {
    if (quantity(await this.read("eth_chainId", [])) !== BigInt(this.chainId))
      throw new Error("Payment RPC chain mismatch");
  }
  async balance(token: string, address: string, block: string) {
    return quantity(
      await this.read("eth_call", [
        {
          to: token,
          data: encodeFunctionData({
            abi: erc20Abi,
            functionName: "balanceOf",
            args: [getAddress(address)],
          }),
        },
        block,
      ]),
    );
  }
  async checkDecimals(value: EvmPaymentAsset, block: string) {
    if (
      quantity(
        await this.read("eth_call", [
          { to: value.token, data: "0x313ce567" },
          block,
        ]),
      ) !== BigInt(value.decimals)
    )
      throw new Error("Payment token decimals mismatch");
  }
}

/** Funding and evidence for a direct ERC-20 payment. Execution stays in CommitController.
 * The intent and Commit ID survive reload in the caller's payment record; chain
 * evidence is re-read rather than persisted as a second transaction state machine. */
export class EvmPayment {
  readonly intent: Readonly<EvmPaymentIntent>;
  private amount: bigint;
  private data: Hex;
  private rpc: PaymentRpc;
  private fetch: typeof globalThis.fetch;

  constructor(
    intent: EvmPaymentIntent,
    options: { rpcUrl: string; fetch?: typeof globalThis.fetch },
  ) {
    const token = Object.freeze(asset(intent.asset));
    const recipient = getAddress(intent.recipient);
    if (BigInt(recipient) === BigInt(0))
      throw new Error("Payment recipient cannot be zero");
    this.intent = Object.freeze({
      asset: token,
      ...(intent.sender ? { sender: getAddress(intent.sender) } : {}),
      recipient,
      amount: intent.amount,
    });
    this.amount = units(intent.amount, token.decimals);
    this.data = encodeFunctionData({
      abi: erc20Abi,
      functionName: "transfer",
      args: [recipient, this.amount],
    });
    this.fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.rpc = new PaymentRpc(token.chainId, options.rpcUrl, this.fetch);
  }

  /** Inspect explicitly catalogued positions; never pick a treasury or development signer. */
  async preflight(
    candidates: readonly EvmFundingSource[],
  ): Promise<EvmPaymentFunding> {
    if (!Array.isArray(candidates) || candidates.length > 100)
      throw new Error("Provide at most 100 known funding positions");
    const sources = await Promise.all(
      candidates.map(async (candidate): Promise<EvmFundingSnapshot> => {
        const source = {
          address: getAddress(candidate.address),
          role: candidate.role,
          asset: asset(candidate.asset),
        };
        const snapshot: EvmFundingSnapshot = {
          source,
          state: "not_operational",
          blockNumber: null,
          balance: null,
          nativeBalance: null,
          nativeGasBudget: null,
          shortfall: null,
        };
        if (source.role !== "operational") return snapshot;
        try {
          const rpc = new PaymentRpc(
            source.asset.chainId,
            candidate.rpcUrl,
            this.fetch,
          );
          await rpc.checkChain();
          const block = await rpc.read("eth_blockNumber", []);
          quantity(block);
          snapshot.blockNumber = String(block);
          const [balance, nativeBalance] = await Promise.all([
            rpc.balance(source.asset.token, source.address, String(block)),
            rpc.read("eth_getBalance", [source.address, block]).then(quantity),
            rpc.checkDecimals(source.asset, String(block)),
          ]);
          snapshot.balance = formatUnits(balance, source.asset.decimals);
          snapshot.nativeBalance = nativeBalance.toString();
          if (
            source.asset.chainId !== this.intent.asset.chainId ||
            !sameAddress(source.asset.token, this.intent.asset.token)
          ) {
            snapshot.state = "route_required";
            return snapshot;
          }
          if (source.asset.decimals !== this.intent.asset.decimals)
            throw new Error("Payment token decimals mismatch");
          snapshot.shortfall = formatUnits(
            balance < this.amount ? this.amount - balance : BigInt(0),
            source.asset.decimals,
          );
          if (balance < this.amount) {
            snapshot.state = "insufficient_token";
            return snapshot;
          }
          if (sameAddress(source.address, this.intent.recipient))
            throw new Error("Payment sender equals recipient");
          const [gas, price] = await Promise.all([
            rpc
              .read("eth_estimateGas", [
                {
                  from: source.address,
                  to: source.asset.token,
                  value: "0x0",
                  data: this.data,
                },
              ])
              .then(quantity),
            rpc.read("eth_gasPrice", []).then(quantity),
          ]);
          const budget = gas * price * BigInt(2);
          if (budget <= BigInt(0))
            throw new Error("Payment gas estimate is unavailable");
          snapshot.nativeGasBudget = budget.toString();
          snapshot.state =
            nativeBalance >= budget ? "funded" : "insufficient_gas";
        } catch {
          snapshot.state = "unavailable";
        }
        return snapshot;
      }),
    );
    return {
      payment: this.intent,
      sources,
      selected:
        sources.find(
          (source) =>
            source.state === "funded" &&
            (!this.intent.sender ||
              sameAddress(source.source.address, this.intent.sender)),
        )?.source ?? null,
      routeFees: sources.some((source) => source.state === "route_required")
        ? "unquoted"
        : "not_applicable",
    };
  }

  /** Reconcile a refreshed durable Commit before offering another signature.
   * Supports direct ERC-20 EOA transfers; swaps, bridges, AA and batches need
   * their own destination evidence and cannot be declared paid by this reader. */
  async status(commit: CommitView): Promise<EvmPaymentStatus> {
    const request = asRecord(commit.review?.request);
    const transactions = request?.transactions;
    const tx =
      Array.isArray(transactions) && transactions.length === 1
        ? asRecord(transactions[0])
        : undefined;
    const simulation = asRecord(request?.simulation);
    const hash =
      commit.transaction_id ??
      commit.wallet_attempt?.transaction_id ??
      (commit.action?.kind === "broadcast"
        ? commit.action.transaction_id
        : null);
    const status: EvmPaymentStatus = {
      commitId: commit.commit_id,
      commitState: commit.state,
      phase:
        commit.state === "awaiting_broadcast"
          ? "signed"
          : commit.state === "submitted"
            ? "submitted"
            : ["failed", "rejected", "expired"].includes(commit.state)
              ? (commit.state as "failed" | "rejected" | "expired")
              : commit.wallet_attempt
                ? "checking_submission"
                : "awaiting_signature",
      simulation:
        typeof simulation?.status === "string"
          ? simulation.status
          : "unavailable",
      transactionId: hash,
      canRequestSignature: false,
      receipt: "unknown",
      recipient: "unverified",
      balanceBefore: null,
      balanceAfter: null,
      balanceDelta: null,
    };
    const knownHashes = [
      commit.transaction_id,
      commit.wallet_attempt?.transaction_id,
      commit.action?.kind === "broadcast" ? commit.action.transaction_id : null,
    ]
      .filter((value): value is string => Boolean(value))
      .map((value) => value.toLowerCase());
    if (new Set(knownHashes).size > 1)
      return {
        ...status,
        phase: "verification_failed",
        reason: "Commit contains conflicting transaction hashes",
      };
    if (
      commit.chain_family !== "evm" ||
      commit.batch !== null ||
      !this.intent.sender ||
      !sameAddress(commit.signer, this.intent.sender) ||
      commit.chain_ref !== String(this.intent.asset.chainId) ||
      request?.type !== "execute_evm" ||
      !tx ||
      tx.chain_id !== this.intent.asset.chainId ||
      !sameAddress(tx.from, commit.signer) ||
      !sameAddress(tx.to, this.intent.asset.token) ||
      typeof tx.data !== "string" ||
      tx.data.toLowerCase() !== this.data ||
      !["0", "0x0", undefined].includes(tx.value as string | undefined) ||
      sameAddress(commit.signer, this.intent.recipient)
    )
      return {
        ...status,
        phase: "verification_failed",
        reason: "Commit does not match the exact direct payment",
      };
    if (commit.wallet_attempt?.state === "mismatched")
      return {
        ...status,
        phase: "verification_failed",
        reason: "Wallet transaction mismatched the review",
      };
    if (!hash) {
      if (commit.state === "confirmed")
        return {
          ...status,
          phase: "verification_failed",
          reason: "Confirmed Commit has no transaction hash",
        };
      status.canRequestSignature =
        commit.state === "needs_signature" &&
        !commit.wallet_attempt &&
        Boolean(commit.review?.digest) &&
        reviewEligibility(commit.review?.request)?.state === "eligible" &&
        status.simulation === "passed" &&
        commit.action?.kind === "sign" &&
        commit.action.payload.kind === "evm_transaction" &&
        commit.action.payload.chain_id === this.intent.asset.chainId &&
        sameAddress(commit.action.payload.signer, commit.signer) &&
        sameAddress(
          commit.action.payload.transaction.to,
          this.intent.asset.token,
        ) &&
        commit.action.payload.transaction.data.toLowerCase() === this.data &&
        ["0", "0x0"].includes(commit.action.payload.transaction.value);
      return status;
    }
    if (!/^0x[0-9a-f]{64}$/i.test(hash))
      return {
        ...status,
        phase: "verification_failed",
        reason: "Invalid payment transaction hash",
      };
    try {
      await this.rpc.checkChain();
      const receipt = asRecord(
        await this.rpc.read("eth_getTransactionReceipt", [hash]),
      );
      if (!receipt)
        return {
          ...status,
          receipt: "pending",
          phase: commit.state === "awaiting_broadcast" ? "signed" : "submitted",
        };
      if (receipt.status === "0x0")
        return {
          ...status,
          receipt: "reverted",
          phase: "failed",
          reason: "Payment transaction reverted",
        };
      if (
        receipt.status !== "0x1" ||
        !sameAddress(receipt.transactionHash, hash) ||
        !sameAddress(receipt.from, commit.signer) ||
        !sameAddress(receipt.to, this.intent.asset.token)
      )
        return {
          ...status,
          phase: "verification_failed",
          reason: "Payment receipt does not match the Commit",
        };
      const block = quantity(receipt.blockNumber);
      if (block === BigInt(0)) throw new Error("Payment block is unavailable");
      const canonical = asRecord(
        await this.rpc.read("eth_getBlockByNumber", [
          receipt.blockNumber,
          false,
        ]),
      );
      if (!canonical || canonical.hash !== receipt.blockHash)
        throw new Error("Payment block is not canonical");
      const transfers = Array.isArray(receipt.logs) ? receipt.logs : [];
      const transferred = transfers.reduce((total: bigint, raw) => {
        const log = asRecord(raw);
        if (
          !log ||
          log.removed === true ||
          !sameAddress(log.address, this.intent.asset.token) ||
          !Array.isArray(log.topics)
        )
          return total;
        try {
          const event = decodeEventLog({
            abi: erc20Abi,
            eventName: "Transfer",
            topics: log.topics as [Hex, ...Hex[]],
            data: log.data as Hex,
          });
          return sameAddress(event.args.from, commit.signer) &&
            sameAddress(event.args.to, this.intent.recipient)
            ? total + event.args.value
            : total;
        } catch {
          return total;
        }
      }, BigInt(0));
      status.receipt = "confirmed";
      if (transferred !== this.amount)
        return {
          ...status,
          phase: "verification_failed",
          reason: "Receipt has no exact matching token transfer",
        };
      await this.rpc.checkDecimals(
        this.intent.asset,
        String(receipt.blockNumber),
      );
      const [before, after] = await Promise.all([
        this.rpc.balance(
          this.intent.asset.token,
          this.intent.recipient,
          `0x${(block - BigInt(1)).toString(16)}`,
        ),
        this.rpc.balance(
          this.intent.asset.token,
          this.intent.recipient,
          String(receipt.blockNumber),
        ),
      ]);
      status.balanceBefore = formatUnits(before, this.intent.asset.decimals);
      status.balanceAfter = formatUnits(after, this.intent.asset.decimals);
      status.balanceDelta = formatUnits(
        after - before,
        this.intent.asset.decimals,
      );
      if (after - before < this.amount)
        return {
          ...status,
          phase: "verification_pending",
          reason:
            "Receipt succeeded; recipient balance increase is not yet verified",
        };
      const latestCanonical = asRecord(
        await this.rpc.read("eth_getBlockByNumber", [
          receipt.blockNumber,
          false,
        ]),
      );
      if (latestCanonical?.hash !== receipt.blockHash)
        throw new Error("Payment block changed during verification");
      return { ...status, phase: "payment_completed", recipient: "verified" };
    } catch {
      return {
        ...status,
        phase: "verification_pending",
        reason:
          "Chain evidence is unavailable; reconcile this transaction before retrying",
      };
    }
  }
}
