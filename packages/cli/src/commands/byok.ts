import type { CliConfig } from "../types";
import { CliSession } from "../cli-session";
import { AomiClient } from "@aomi-labs/client";
import { createCliAuthTokenProvider } from "../auth";
import { fatal } from "../errors";
import { printDataFileLocation, printJson } from "../output";

const SUPPORTED_PROVIDERS = new Set(["openai", "anthropic", "openrouter"]);

function parseByokKeyArg(input: string): { provider: string; byokKey: string } {
  const [providerPart, byokKeyPart] = input.split(/:(.+)/, 2);
  const provider = providerPart?.trim().toLowerCase();
  const byokKey = byokKeyPart?.trim();

  if (!provider || !byokKey) {
    fatal("Invalid format. Use: <provider>:<key> (e.g. anthropic:sk-ant-...)");
  }

  if (!SUPPORTED_PROVIDERS.has(provider)) {
    fatal(
      `Unknown provider "${provider}". Supported: anthropic, openai, openrouter`,
    );
  }

  return { provider, byokKey };
}

async function createByokKeyClient(
  config: CliConfig,
): Promise<{ cli: CliSession; client: AomiClient }> {
  const cli = CliSession.loadOrCreate(config);
  const client = new AomiClient({
    baseUrl: cli.baseUrl,
    apiKey: cli.apiKey,
    getAccountBearer: createCliAuthTokenProvider(() => cli.toState()),
  });

  return { cli, client };
}

export async function saveByokKeyCommand(
  config: CliConfig,
  byokKeyInput: string,
  options?: { printLocation?: boolean },
): Promise<void> {
  const { provider, byokKey } = parseByokKeyArg(byokKeyInput);
  const { cli, client } = await createByokKeyClient(config);
  const saved = await client.saveByokKey(cli.sessionId, provider, byokKey);

  if (config.json) {
    printJson(saved);
    return;
  }

  console.log(`BYOK key set for ${saved.provider}: ${saved.key_prefix}...`);
  if (options?.printLocation !== false) {
    printDataFileLocation();
  }
}

export async function showByokKeysCommand(
  config: CliConfig,
  options?: { printLocation?: boolean },
): Promise<void> {
  const { cli, client } = await createByokKeyClient(config);
  const byokKeys = await client.listByokKeys(cli.sessionId);

  if (config.json) {
    printJson(byokKeys);
    return;
  }

  if (byokKeys.length === 0) {
    console.log("No BYOK keys set. Using system keys.");
  } else {
    for (const key of byokKeys) {
      console.log(`  ${key.provider}: ${key.key_prefix}...`);
    }
  }

  if (options?.printLocation !== false) {
    printDataFileLocation();
  }
}

export async function clearByokKeysCommand(
  config: CliConfig,
  options?: { printLocation?: boolean },
): Promise<void> {
  const { cli, client } = await createByokKeyClient(config);
  const byokKeys = await client.listByokKeys(cli.sessionId);

  if (config.json) {
    for (const key of byokKeys) {
      await client.deleteByokKey(cli.sessionId, key.provider);
    }
    printJson({ deleted: byokKeys.map((key) => key.provider) });
    return;
  }

  if (byokKeys.length === 0) {
    console.log("No BYOK keys set. Using system keys.");
    if (options?.printLocation !== false) {
      printDataFileLocation();
    }
    return;
  }

  for (const key of byokKeys) {
    await client.deleteByokKey(cli.sessionId, key.provider);
  }

  console.log("BYOK keys cleared. Using system keys.");
  if (options?.printLocation !== false) {
    printDataFileLocation();
  }
}
