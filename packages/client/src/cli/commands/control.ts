import { SUPPORTED_CHAIN_IDS, CHAIN_NAMES } from "../../chains";
import { CliSession } from "../cli-session";
import { createControlClient } from "../context";
import { printDataFileLocation, printJson } from "../output";
import type { CliConfig } from "../types";
import { fatal } from "../errors";

export async function statusCommand(config: CliConfig): Promise<void> {
  const cli = CliSession.load();
  if (!cli) {
    if (config.json) {
      printJson({ active: false });
      return;
    }
    console.log("No active session");
    printDataFileLocation({ verbose: config.verbose });
    return;
  }
  cli.mergeConfig(config);

  const session = cli.createClientSession(config);
  try {
    await session.fetchCurrentState();
    const snapshot = session.getSnapshot();
    console.log(
      JSON.stringify(
        {
          sessionId: cli.sessionId,
          baseUrl: cli.baseUrl,
          mode: cli.agentMode,
          app: cli.agentMode === "direct" ? (cli.app ?? null) : null,
          applicationId:
            cli.agentMode === "direct" ? (cli.applicationId ?? null) : null,
          model: cli.model ?? null,
          chainId: cli.chainId ?? null,
          turnState: snapshot.turnState ?? null,
          isSubmitting: snapshot.isSubmitting,
          messageCount: snapshot.messages.length,
          title: snapshot.title ?? null,
          actions: snapshot.actions.length,
          pendingActions: session.actions.pending().length,
        },
        null,
        2,
      ),
    );
    printDataFileLocation({ verbose: config.verbose });
  } finally {
    session.close();
  }
}

export async function eventsCommand(config: CliConfig): Promise<void> {
  const cli = CliSession.load();
  if (!cli) {
    console.log("No active session");
    return;
  }
  cli.mergeConfig(config);

  const session = cli.createClientSession(config);
  try {
    const page = await session.client.agent.poll(cli.sessionId);
    console.log(JSON.stringify(page.events, null, 2));
  } finally {
    session.close();
  }
}

export async function interruptCommand(config: CliConfig): Promise<void> {
  const cli = CliSession.load();
  if (!cli) {
    fatal("No active session to interrupt.");
  }
  cli.mergeConfig(config);

  const session = cli.createClientSession(config);
  try {
    await session.fetchCurrentState();
    await session.interrupt();
    if (config.json) {
      printJson({ sessionId: cli.sessionId, interrupted: true });
      return;
    }
    console.log(`Interrupted session ${cli.sessionId}.`);
    printDataFileLocation({ verbose: config.verbose });
  } finally {
    session.close();
  }
}

export async function appsCommand(config: CliConfig): Promise<void> {
  const client = createControlClient(config);
  const cli = CliSession.load();
  const response = await client.pipeline.apps.list();
  const apps = response.entries.map((entry) => ({ name: entry.name }));

  if (apps.length === 0) {
    if (config.json) {
      printJson([]);
      return;
    }
    console.log("No apps available.");
    return;
  }

  const currentApp = cli?.agentMode === "direct" ? cli.app : config.app;
  if (config.json) {
    printJson(
      apps.map((descriptor) => ({
        ...descriptor,
        current: currentApp === descriptor.name,
      })),
    );
    return;
  }
  for (const descriptor of apps) {
    const name = String(descriptor.name ?? "");
    const marker = currentApp === name ? "  (current)" : "";
    console.log(`${name}${marker}`);
  }
}

export async function modelsCommand(config: CliConfig): Promise<void> {
  const client = createControlClient(config);
  const cli = CliSession.load();
  const sessionId = cli?.sessionId ?? crypto.randomUUID();
  const models = await client.getModels(sessionId, {
    apiKey: config.apiKey ?? cli?.apiKey,
  });

  if (models.length === 0) {
    console.log("No models available.");
    return;
  }

  for (const model of models) {
    const marker = cli?.model === model ? "  (current)" : "";
    console.log(`${model}${marker}`);
  }
}

export function currentAppCommand(config: CliConfig = { secrets: {} }): void {
  const cli = CliSession.load();
  if (!cli) {
    if (config.json) {
      printJson({ active: false, app: null });
      return;
    }
    console.log("No active session");
    printDataFileLocation({ verbose: config.verbose });
    return;
  }
  if (config.json) {
    printJson({
      active: true,
      mode: cli.agentMode,
      app: cli.agentMode === "direct" ? (cli.app ?? null) : null,
      applicationId:
        cli.agentMode === "direct" ? (cli.applicationId ?? null) : null,
    });
    return;
  }
  console.log(
    cli.agentMode === "auto"
      ? "Auto (no Direct app)"
      : (cli.app ?? `application ${cli.applicationId}`),
  );
  printDataFileLocation({ verbose: config.verbose });
}

export function currentChainCommand(config: CliConfig = { secrets: {} }): void {
  const cli = CliSession.load();
  if (!cli) {
    if (config.json) {
      printJson({ active: false, chainId: null });
      return;
    }
    console.log("No active session");
    printDataFileLocation({ verbose: config.verbose });
    return;
  }
  if (config.json) {
    printJson({ active: true, chainId: cli.chainId ?? null });
    return;
  }
  if (cli.chainId === undefined) {
    console.log("No active chain");
  } else {
    console.log(String(cli.chainId));
  }
  printDataFileLocation({ verbose: config.verbose });
}

export function currentBackendCommand(): void {
  const cli = CliSession.load();
  if (!cli) {
    console.log("No active session");
    printDataFileLocation();
    return;
  }
  console.log(cli.baseUrl);
  printDataFileLocation();
}

export function currentWalletCommand(
  config: CliConfig = { secrets: {} },
): void {
  const cli = CliSession.load();
  if (!cli) {
    if (config.json) {
      printJson({ active: false, wallets: [] });
      return;
    }
    console.log("No active session");
    printDataFileLocation({ verbose: config.verbose });
    return;
  }

  const state = cli.toState();
  const wallets = [
    cli.publicKey
      ? {
          family: "evm",
          address: cli.publicKey,
          chainId: cli.chainId ?? null,
          hasSavedSigner: Boolean(cli.privateKey),
        }
      : null,
    state.svmPublicKey
      ? {
          // "svm" is the canonical family name (matches the backend wire key
          // and the account-graph API); "solana" was the deprecated alias.
          family: "svm",
          address: state.svmPublicKey,
          cluster: state.svmCluster ?? null,
          hasSavedSigner: Boolean(state.svmPrivateKey),
        }
      : null,
  ].filter((wallet): wallet is NonNullable<typeof wallet> => wallet !== null);
  if (config.json) {
    printJson({ active: true, wallets });
    return;
  }
  const hasAny = cli.publicKey || state.svmPublicKey;
  if (!hasAny) {
    console.log("No wallet configured");
    printDataFileLocation({ verbose: config.verbose });
    return;
  }

  if (cli.publicKey) {
    const signerStatus = cli.privateKey ? "saved signer" : "address only";
    console.log(`EVM:    ${cli.publicKey} (${signerStatus})`);
  }
  if (state.svmPublicKey) {
    const signerStatus = state.svmPrivateKey ? "saved signer" : "address only";
    const clusterSuffix = state.svmCluster ? `, ${state.svmCluster}` : "";
    console.log(
      `Solana: ${state.svmPublicKey} (${signerStatus}${clusterSuffix})`,
    );
  }
  printDataFileLocation({ verbose: config.verbose });
}

export function currentModelCommand(): void {
  const cli = CliSession.load();
  if (!cli) {
    console.log("No active session");
    printDataFileLocation();
    return;
  }
  console.log(cli.model ?? "(default backend model)");
  printDataFileLocation();
}

export function setAppCommand(
  config: CliConfig,
  app: string,
  options?: { printLocation?: boolean },
): void {
  const trimmed = app.trim();
  if (!trimmed) {
    fatal("Usage: aomi app set <app-name>");
  }

  const cli = CliSession.loadOrCreate({
    ...config,
    agentMode: "direct",
    app: trimmed,
  });
  cli.mergeConfig({
    ...config,
    agentMode: "direct",
    app: trimmed,
  });

  console.log(`App set to ${trimmed}`);
  if (options?.printLocation !== false) {
    printDataFileLocation();
  }
}

export function setAgentModeCommand(
  config: CliConfig,
  mode: "auto" | "direct",
  app?: string,
  options?: { printLocation?: boolean },
): void {
  const selectedApp = app?.trim();
  const cli = CliSession.loadOrCreate(config);
  cli.setAgentRouting(mode, selectedApp ? { app: selectedApp } : undefined);
  console.log(
    mode === "auto"
      ? "Mode set to Auto"
      : `Mode set to Direct (${selectedApp ?? cli.app ?? (cli.applicationId ? `application ${cli.applicationId}` : "default")})`,
  );
  if (options?.printLocation !== false) {
    printDataFileLocation({ verbose: config.verbose });
  }
}

export async function setModelCommand(
  config: CliConfig,
  model: string,
  options?: { printLocation?: boolean },
): Promise<void> {
  const cli = CliSession.loadOrCreate(config);
  cli.setModel(model);
  console.log(`Model set to ${model}`);
  if (options?.printLocation !== false) {
    printDataFileLocation({ verbose: config.verbose });
  }
}

export function chainsCommand(config: CliConfig = { secrets: {} }): void {
  const cli = CliSession.load();
  const currentChainId = cli?.chainId;
  // AA chain support lives in the backend AA lane now; the CLI only lists
  // the chains themselves.
  const chains = SUPPORTED_CHAIN_IDS.map((id) => ({
    id,
    name: CHAIN_NAMES[id] ?? `Chain ${id}`,
    current: currentChainId === id,
  }));
  if (config.json) {
    printJson(chains);
    return;
  }

  for (const chain of chains) {
    const marker = chain.current ? "  (current)" : "";
    console.log(`${chain.id}  ${chain.name}${marker}`);
  }
}
