import type { TransactionSafetyMode } from "@aomi-labs/client";
import { CliSession } from "../cli-session";
import { fatal } from "../errors";
import { printJson } from "../output";
import type { CliConfig } from "../types";
import { remoteThreadId } from "./threads";

export async function guardCommand(
  config: CliConfig,
  input: { mode?: string; account?: boolean; thread?: string },
): Promise<void> {
  if (input.account && input.thread) fatal("Choose --account or --thread.");
  const cli = CliSession.loadOrCreate(config);
  const session = cli.createClientSession(config);
  try {
    const transport = session.client.transactionSafety;
    const threadId = remoteThreadId(input.thread ?? cli.sessionId);
    const current = input.account
      ? await transport.getAccountDefault()
      : await transport.getThread(threadId);
    let policy = current;
    if (input.mode !== undefined) {
      const mode = input.mode as TransactionSafetyMode;
      if (!["guarded_only", "balanced", "unrestricted"].includes(mode))
        fatal("Mode must be guarded_only, balanced, or unrestricted.");
      if (input.account && mode === "unrestricted")
        fatal(
          "Account defaults cannot be unrestricted; choose a thread explicitly.",
        );
      policy = input.account
        ? await transport.setAccountDefault(
            mode as Exclude<TransactionSafetyMode, "unrestricted">,
            current.revision,
          )
        : await transport.setThread(threadId, mode, current.revision);
    }
    if (config.json) printJson(policy);
    else console.log(`${policy.mode}\t revision ${policy.revision}`);
  } finally {
    session.close();
  }
}
