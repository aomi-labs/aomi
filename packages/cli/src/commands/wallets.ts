import { AomiWallets, type AomiAccountWallet } from "@aomi-labs/client";
import { CliSession } from "../cli-session";
import { fatal } from "../errors";
import { printJson } from "../output";
import type { CliConfig } from "../types";

function formatWalletsTable(wallets: AomiAccountWallet[]): string {
  const rows = [
    ["ID", "KIND", "FAMILY", "ADDRESS", "LABEL"],
    ...wallets.map((wallet) => [
      wallet.id,
      wallet.kind,
      wallet.family,
      wallet.address,
      wallet.label,
    ]),
  ];
  const widths = rows[0]!.map((_, column) =>
    Math.max(...rows.map((row) => row[column]!.length)),
  );
  return rows
    .map((row) =>
      row
        .map((cell, column) =>
          column === row.length - 1 ? cell : cell.padEnd(widths[column]!),
        )
        .join("  "),
    )
    .join("\n");
}

/** `aomi wallets`: every wallet the account owns. */
export async function walletsListCommand(config: CliConfig): Promise<void> {
  const cli = CliSession.loadOrCreate(config);
  const session = cli.createClientSession(config);
  try {
    const wallets = await new AomiWallets(session.client).list();
    if (config.json) printJson(wallets);
    else if (wallets.length === 0) console.log("No wallets yet.");
    else console.log(formatWalletsTable(wallets));
  } finally {
    session.close();
  }
}

/** `aomi wallets use <id>`: make a wallet the active one for this session's thread. */
export async function walletsUseCommand(
  config: CliConfig,
  id: string,
): Promise<void> {
  if (!id) fatal("Usage: aomi wallets use <id>");
  const cli = CliSession.loadOrCreate(config);
  const session = cli.createClientSession(config);
  try {
    const threadId = cli.sessionId;
    const result = await session.client.account.wallets.setThreadWallet(
      threadId,
      id,
    );
    if (config.json) printJson(result);
    else {
      const families = Object.entries(result.active_wallet)
        .map(([family, wallet]) => `${family} ${wallet}`)
        .join(", ");
      console.log(
        `Using ${id} in session ${threadId}${families ? ` (active: ${families})` : ""}`,
      );
    }
  } finally {
    session.close();
  }
}
