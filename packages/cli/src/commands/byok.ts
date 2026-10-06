import type { CliConfig } from "../types";
import { CliSession } from "../cli-session";
import { createCliClient } from "../client-factory";
import { fatal } from "../errors";
import { printDataFileLocation } from "../output";

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
): Promise<{ cli: CliSession; client: ReturnType<typeof createCliClient> }> {
  const cli = CliSession.loadOrCreate(config);
  const client = createCliClient(config, {
    baseUrl: cli.baseUrl,
    apiKey: cli.apiKey,
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
