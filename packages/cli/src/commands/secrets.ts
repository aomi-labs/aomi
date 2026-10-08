import { CliSession } from "../cli-session";
import { ingestSecretsForSession } from "../context";
import { fatal } from "../errors";
import { printDataFileLocation } from "../output";
import type { CliConfig } from "../types";

export async function ingestSecretsCommand(config: CliConfig): Promise<void> {
  const secretEntries = Object.entries(config.secrets);
  if (secretEntries.length === 0) {
    fatal("Usage: aomi secret add NAME=value [NAME=value ...]");
  }

  const cli = CliSession.loadOrCreate(config);
  const session = cli.createClientSession(config);

  try {
    const handles = await ingestSecretsForSession(config, cli, session.client);
    const names = Object.keys(handles).sort();
    console.log(
      `Configured ${names.length} secret${names.length === 1 ? "" : "s"} for session ${cli.sessionId}.`,
    );
    for (const name of names) {
      console.log(`${name}  ${handles[name]}`);
    }
    printDataFileLocation();
  } finally {
    session.close();
  }
}

export function listSecretsCommand(): void {
  const cli = CliSession.load();
  if (!cli) {
    console.log("No active session");
    printDataFileLocation();
    return;
  }

  const handles = cli.secretHandles;
  const names = Object.keys(handles).sort();
  if (names.length === 0) {
    console.log("No secrets configured.");
    printDataFileLocation();
    return;
  }

  for (const name of names) {
    console.log(`${name}  ${handles[name]}`);
  }
  printDataFileLocation();
}

export async function clearSecretsCommand(config: CliConfig): Promise<void> {
  const cli = CliSession.loadOrCreate(config);
  const clientId = cli.clientId;
  if (!clientId) {
    console.log("No secrets configured.");
    printDataFileLocation();
    return;
  }

  const session = cli.createClientSession(config);
  try {
    await session.client.clearSecrets(cli.sessionId, clientId);
    cli.clearSecretHandles();
    console.log("Cleared all secrets for the active session.");
    printDataFileLocation();
  } finally {
    session.close();
  }
}
