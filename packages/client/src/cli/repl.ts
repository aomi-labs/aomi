import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { chatCommand } from "./commands/chat";
import {
  modelsCommand,
  setAgentModeCommand,
  setAppCommand,
  setModelCommand,
} from "./commands/control";
import {
  clearByokKeysCommand,
  saveByokKeyCommand,
  showByokKeysCommand,
} from "./commands/byok";
import { buildCliConfig } from "./commands/defs/shared";
import { CliSession } from "./cli-session";
import { CliExit, fatal } from "./errors";
import type { CliConfig } from "./types";

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function printReplHelp(): void {
  console.log("Commands:");
  console.log("  /heap                  Show this message");
  console.log("  /mode auto             Use automatic routing");
  console.log(
    "  /mode direct [app]     Route directly (default app if omitted)",
  );
  console.log("  /app <name>            Shorthand for /mode direct [app]");
  console.log("  /model <rig>           Set the active backend model");
  console.log("  /model list            Show available models");
  console.log("  /model show            Show the current model");
  console.log("  /key <provider:key>    Set a BYOK provider key");
  console.log("  /key show              Show current BYOK provider key status");
  console.log("  /key clear             Clear all BYOK provider keys");
  console.log("  :exit                  Quit the CLI");
}

function currentModelLabel(config: CliConfig): string {
  const cli = CliSession.loadOrCreate(config);
  return cli.model ?? "(default backend model)";
}

async function handleModelCommand(
  config: CliConfig,
  command: string,
): Promise<void> {
  if (!command) {
    fatal("Usage: /model <rig> | /model list | /model show");
  }

  if (command === "list") {
    await modelsCommand(config);
    return;
  }

  if (command === "show") {
    console.log(`Model: ${currentModelLabel(config)}`);
    return;
  }

  const [action, maybeModel] = command.split(/\s+/, 2);

  if ((action === "main" || action === "small") && !maybeModel) {
    fatal(`Usage: /model ${action} <rig>`);
  }

  const nextModel =
    action === "main" || action === "small" ? maybeModel : command;
  if (!nextModel) {
    fatal("Usage: /model <rig>");
  }

  await setModelCommand(config, nextModel, { printLocation: false });
  config.model = nextModel;
}

async function handleKeyCommand(
  config: CliConfig,
  command: string,
): Promise<void> {
  if (!command) {
    fatal("Usage: /key <provider:key> | /key show | /key clear");
  }

  if (command === "show") {
    await showByokKeysCommand(config, { printLocation: false });
    return;
  }

  if (command === "clear") {
    await clearByokKeysCommand(config, { printLocation: false });
    return;
  }

  await saveByokKeyCommand(config, command, { printLocation: false });
}

export async function handleReplLine(
  config: CliConfig,
  line: string,
  showTool: boolean,
): Promise<"exit" | "continue"> {
  const trimmed = line.trim();
  if (!trimmed) {
    return "continue";
  }

  if (trimmed === ":exit" || trimmed === ":quit") {
    return "exit";
  }

  if (trimmed === "/heap") {
    printReplHelp();
    return "continue";
  }

  if (trimmed === "/app" || trimmed.startsWith("/app ")) {
    const app = trimmed.slice("/app".length).trim();
    if (!app) {
      fatal("Usage: /app <app-name>");
    }
    setAppCommand(config, app, { printLocation: false });
    config.agentMode = "direct";
    config.app = app;
    delete config.applicationId;
    return "continue";
  }

  if (trimmed === "/mode" || trimmed.startsWith("/mode ")) {
    const command = trimmed.slice("/mode".length).trim();
    const [rawMode, ...appParts] = command.split(/\s+/u);
    if (rawMode !== "auto" && rawMode !== "direct") {
      fatal("Usage: /mode auto | /mode direct [app-name]");
    }
    const app = appParts.join(" ").trim() || undefined;
    if (rawMode === "auto" && app) {
      fatal("Usage: /mode auto");
    }
    setAgentModeCommand(config, rawMode, app, { printLocation: false });
    config.agentMode = rawMode;
    delete config.app;
    delete config.applicationId;
    if (rawMode === "direct" && app) {
      config.app = app;
    }
    return "continue";
  }

  if (trimmed === "/model" || trimmed.startsWith("/model ")) {
    const command = trimmed.slice("/model".length).trim();
    await handleModelCommand(config, command);
    return "continue";
  }

  if (trimmed === "/key" || trimmed.startsWith("/key ")) {
    const command = trimmed.slice("/key".length).trim();
    await handleKeyCommand(config, command);
    return "continue";
  }

  await chatCommand(config, trimmed, showTool);
  return "continue";
}

export async function runInteractiveCli(
  config: CliConfig,
  options?: { showTool?: boolean },
): Promise<void> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    fatal(
      "Interactive mode requires a TTY. Use `--prompt` for non-interactive usage.",
    );
  }

  CliSession.loadOrCreate(config);

  console.log("Interactive Aomi CLI ready.");
  console.log(
    "Commands: /heap, /mode auto|direct [app], /app <name>, /model <rig>|list|show, /key, :exit",
  );

  const rl = createInterface({ input, output });
  try {
    while (true) {
      const line = await rl.question("> ");
      try {
        const next = await handleReplLine(
          config,
          line,
          options?.showTool === true,
        );
        if (next === "exit") {
          break;
        }
      } catch (err) {
        if (err instanceof CliExit) {
          continue;
        }
        throw err;
      }
    }
  } finally {
    rl.close();
  }
}

export async function runRootCli(args: Record<string, unknown>): Promise<void> {
  let config = buildCliConfig(args);
  const prompt = str(args.prompt);
  const showTool = args["show-tool"] === true;
  const byokKey = str(args["provider-key"]);

  if (byokKey) {
    await saveByokKeyCommand(config, byokKey, { printLocation: false });
    // Saving a key can create the backing session/client binding. Reuse it
    // for the following prompt instead of spawning a second fresh session.
    config = { ...config, freshSession: false };
  }

  if (prompt) {
    await chatCommand(config, prompt, showTool);
    return;
  }

  await runInteractiveCli(config, { showTool });
}
