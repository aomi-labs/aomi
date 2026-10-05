import {
  decodeFunctionData,
  encodeAbiParameters,
  encodeFunctionData,
  toFunctionSelector,
  type Abi,
  type AbiFunction,
  type Hex,
} from "viem";

import type { Action, ActionRequest } from "./agent/types";
import type { SignableCommit } from "./commits";

/** One contract call the application approved before Aomi built anything. */
export interface ExpectedCall {
  /** When set, the request must target this EVM chain. */
  chainId?: number;
  /** Contract address; compared case-insensitively. */
  to: string;
  /** ABI used to decode the request's calldata. */
  abi: Abi;
  functionName: string;
  /** ABI-equivalent arguments; omitted means the function takes none. */
  args?: readonly unknown[];
  /** Native value in wei; omitted means zero. */
  value?: bigint | number | string;
}

export interface ExpectedCallsOptions {
  /**
   * Accept a request whose simulation is `"unavailable"`. A `"failed"` or
   * `"pending"` simulation is always a mismatch.
   */
  allowUnavailableSimulation?: boolean;
}

/** Subjects ExpectedCalls can check before anything is signed. */
export type CallVerificationSubject =
  | Action
  | ActionRequest
  | SignableCommit
  | null
  | undefined;

export type CallVerificationField =
  | "request"
  | "simulation"
  | "count"
  | "chainId"
  | "to"
  | "function"
  | "args"
  | "value"
  | "data";

export interface CallMismatch {
  /** Zero-based call index, or null for request-level mismatches. */
  call: number | null;
  field: CallVerificationField;
  /** Zero-based argument index for `args` mismatches on one argument. */
  argIndex?: number;
  expected?: unknown;
  actual?: unknown;
  message: string;
}

/** A call as found in the request, decoded with the expected ABI when possible. */
export interface VerifiedCall {
  chainId?: number;
  to: string;
  /** Native value in wei, or null when the request's value is unparseable. */
  value: bigint | null;
  data: Hex;
  functionName?: string;
  args?: readonly unknown[];
}

export interface CallVerification {
  ok: boolean;
  /**
   * Simulation status carried by the request, or null for a SignableCommit,
   * which is the exact wallet payload and carries no simulation of its own.
   */
  simulation: "pending" | "passed" | "failed" | "unavailable" | null;
  calls: VerifiedCall[];
  mismatches: CallMismatch[];
}

export class CallVerificationError extends Error {
  constructor(readonly verification: CallVerification) {
    super(
      [
        "Aomi request does not match the expected calls:",
        ...verification.mismatches.map((mismatch) => `- ${mismatch.message}`),
      ].join("\n"),
    );
    this.name = "CallVerificationError";
  }
}

/**
 * The calls an application approved, checked against what Aomi built before
 * the local wallet signs. Calls match positionally; every mismatch is listed.
 *
 * Accepts an Action, an ActionRequest (`action.request` or
 * `session.commits.review(id)`), or the EVM `SignableCommit` handed to
 * `evm.signTransaction`. `execute_evm` requests must have passed simulation.
 * EVM `sign` requests are checked through their declared `calls` and the
 * simulation status in their transaction-safety projection.
 */
export class ExpectedCalls {
  readonly calls: readonly ExpectedCall[];

  constructor(
    calls: ExpectedCall | readonly ExpectedCall[],
    readonly options: ExpectedCallsOptions = {},
  ) {
    this.calls = Array.isArray(calls) ? [...calls] : [calls as ExpectedCall];
    if (this.calls.length === 0)
      throw new TypeError("ExpectedCalls needs at least one call");
  }

  verify(subject: CallVerificationSubject): CallVerification {
    const mismatches: CallMismatch[] = [];
    const request =
      subject && "type" in subject && subject.type === "action"
        ? subject.request
        : subject;
    let found:
      | { chainId?: number; to: string; value?: string; data?: string | null }[]
      | undefined;
    let simulation: CallVerification["simulation"] = null;

    if (!request) {
      mismatches.push({
        call: null,
        field: "request",
        message: "No request to verify",
      });
    } else if ("kind" in request) {
      if (request.kind === "evm_transaction")
        found = [{ chainId: request.chain_id, ...request.transaction }];
    } else if (request.type === "execute_evm") {
      found = request.transactions.map((transaction) => ({
        chainId: transaction.chain_id,
        to: transaction.to,
        value: transaction.value,
        data: transaction.data,
      }));
      simulation = request.simulation.status;
    } else if (request.type === "sign" && request.chainFamily === "evm") {
      found = request.calls?.map((call) => ({
        chainId: request.chainId,
        ...call,
      }));
      simulation = request.transactionSafety?.simulationStatus ?? "unavailable";
    }
    if (request && !found?.length) {
      const kind = "kind" in request ? request.kind : request.type;
      mismatches.push({
        call: null,
        field: "request",
        actual: kind,
        message: `Request ${kind} carries no EVM contract calls to verify`,
      });
    }

    if (
      found?.length &&
      simulation !== null &&
      simulation !== "passed" &&
      !(simulation === "unavailable" && this.options.allowUnavailableSimulation)
    ) {
      mismatches.push({
        call: null,
        field: "simulation",
        expected: this.options.allowUnavailableSimulation
          ? "passed or unavailable"
          : "passed",
        actual: simulation,
        message: `Simulation is ${simulation}, expected passed${
          this.options.allowUnavailableSimulation ? " or unavailable" : ""
        }`,
      });
    }
    if (found?.length && found.length !== this.calls.length) {
      mismatches.push({
        call: null,
        field: "count",
        expected: this.calls.length,
        actual: found.length,
        message: `Request has ${found.length} call(s), expected ${this.calls.length}`,
      });
    }

    const calls = (found ?? []).map((call, index): VerifiedCall => {
      const data = (call.data ?? "0x") as Hex;
      let value: bigint | null;
      try {
        value = BigInt(call.value ?? 0);
      } catch {
        value = null;
        mismatches.push({
          call: index,
          field: "value",
          actual: call.value,
          message: `Call ${index} has an unparseable value ${call.value}`,
        });
      }
      const verified: VerifiedCall = {
        chainId: call.chainId,
        to: call.to,
        value,
        data,
      };
      const expected = this.calls[index];
      if (!expected) return verified;

      if (expected.chainId !== undefined && call.chainId !== expected.chainId)
        mismatches.push({
          call: index,
          field: "chainId",
          expected: expected.chainId,
          actual: call.chainId,
          message: `Call ${index} targets chain ${call.chainId ?? "unknown"}, expected ${expected.chainId}`,
        });
      if (call.to.toLowerCase() !== expected.to.toLowerCase())
        mismatches.push({
          call: index,
          field: "to",
          expected: expected.to,
          actual: call.to,
          message: `Call ${index} targets ${call.to}, expected ${expected.to}`,
        });
      const expectedValue = BigInt(expected.value ?? 0);
      if (value !== null && value !== expectedValue)
        mismatches.push({
          call: index,
          field: "value",
          expected: expectedValue,
          actual: value,
          message: `Call ${index} sends value ${value}, expected ${expectedValue}`,
        });

      let decoded: { functionName: string; args?: readonly unknown[] };
      try {
        decoded = decodeFunctionData({ abi: expected.abi, data });
      } catch {
        mismatches.push({
          call: index,
          field: "function",
          expected: expected.functionName,
          actual: data.slice(0, 10),
          message: `Call ${index} selector ${data.slice(0, 10)} matches no function in the expected ABI, expected ${expected.functionName}`,
        });
        return verified;
      }
      const args = decoded.args ?? [];
      verified.functionName = decoded.functionName;
      verified.args = args;
      if (decoded.functionName !== expected.functionName) {
        mismatches.push({
          call: index,
          field: "function",
          expected: expected.functionName,
          actual: decoded.functionName,
          message: `Call ${index} invokes ${decoded.functionName}, expected ${expected.functionName}`,
        });
        return verified;
      }

      // Compare ABI encodings so bigint/number, address case, and bytes case
      // are judged exactly as the contract will see them.
      const item = expected.abi.find(
        (entry): entry is AbiFunction =>
          entry.type === "function" &&
          toFunctionSelector(entry) === data.slice(0, 10).toLowerCase(),
      )!;
      const expectedArgs = expected.args ?? [];
      if (expectedArgs.length !== args.length) {
        mismatches.push({
          call: index,
          field: "args",
          expected: expectedArgs,
          actual: args,
          message: `Call ${index} passes ${args.length} argument(s), expected ${expectedArgs.length}`,
        });
        return verified;
      }
      let argsMatch = true;
      item.inputs.forEach((input, argIndex) => {
        const actualEncoded = encodeAbiParameters(
          [input],
          [args[argIndex]],
        ).toLowerCase();
        let expectedEncoded: string | undefined;
        try {
          expectedEncoded = encodeAbiParameters(
            [input],
            [expectedArgs[argIndex]],
          ).toLowerCase();
        } catch {
          expectedEncoded = undefined;
        }
        if (expectedEncoded === actualEncoded) return;
        argsMatch = false;
        const name = input.name || String(argIndex);
        mismatches.push({
          call: index,
          field: "args",
          argIndex,
          expected: expectedArgs[argIndex],
          actual: args[argIndex],
          message:
            expectedEncoded === undefined
              ? `Call ${index} expected argument ${name} is not a valid ${input.type}: ${ExpectedCalls.format(expectedArgs[argIndex])}`
              : `Call ${index} argument ${name} (${input.type}) is ${ExpectedCalls.format(args[argIndex])}, expected ${ExpectedCalls.format(expectedArgs[argIndex])}`,
        });
      });
      if (
        argsMatch &&
        encodeFunctionData({
          abi: [item],
          functionName: item.name,
          args,
        }).toLowerCase() !== data.toLowerCase()
      )
        mismatches.push({
          call: index,
          field: "data",
          actual: data,
          message: `Call ${index} calldata has bytes beyond the encoded ${item.name} arguments`,
        });
      return verified;
    });

    return { ok: mismatches.length === 0, simulation, calls, mismatches };
  }

  /** Verify and return the decoded calls, or throw CallVerificationError. */
  assert(subject: CallVerificationSubject): VerifiedCall[] {
    const verification = this.verify(subject);
    if (!verification.ok) throw new CallVerificationError(verification);
    return verification.calls;
  }

  private static format(value: unknown): string {
    return (
      JSON.stringify(value, (_key, item: unknown) =>
        typeof item === "bigint" ? item.toString() : item,
      ) ?? String(value)
    );
  }
}
