import { readFileSync } from "node:fs";
import {
  CommitController,
  EvmPayment,
  type EvmFundingSource,
  type EvmPaymentIntent,
} from "@aomi-labs/client";
import { CliSession } from "../cli-session";
import { createControlClient } from "../context";
import { fatal } from "../errors";
import { printJson } from "../output";
import type { CliConfig } from "../types";

function paymentFile(path: string) {
  const input = JSON.parse(readFileSync(path, "utf8")) as {
    payment?: EvmPaymentIntent;
    rpcUrl?: string;
    sources?: EvmFundingSource[];
  };
  if (!input?.payment || typeof input.rpcUrl !== "string")
    throw new Error("Payment file requires payment and rpcUrl");
  return {
    input,
    payment: new EvmPayment(input.payment, { rpcUrl: input.rpcUrl }),
  };
}

export async function paymentPreflightCommand(path: string): Promise<void> {
  try {
    const { input, payment } = paymentFile(path);
    if (!Array.isArray(input.sources))
      throw new Error("Funding preflight requires known source positions");
    printJson(await payment.preflight(input.sources));
  } catch (error) {
    fatal(
      `Payment preflight failed: ${error instanceof Error ? error.message : "invalid input"}`,
    );
  }
}

export async function paymentStatusCommand(
  config: CliConfig,
  id: string,
  path: string,
): Promise<void> {
  const cli = CliSession.load();
  if (!cli)
    fatal("No active session; resume the payment's original session first");
  const commits = new CommitController(
    createControlClient({
      ...config,
      baseUrl: config.baseUrl ?? cli.toState().baseUrl,
    }),
    cli.sessionId,
  );
  try {
    const { payment } = paymentFile(path);
    // All reconciliation and receipt checks belong to the shared client.
    printJson(await payment.status(await commits.refresh(id)));
  } catch (error) {
    fatal(
      `Payment status failed: ${error instanceof Error ? error.message : "invalid input"}`,
    );
  } finally {
    commits.close();
  }
}
