import type { AomiAppDescriptor, AomiUserAppSecrets } from "../../types";
import type { AomiClient } from "../../client";
import { CliSession } from "../cli-session";
import { createControlClient } from "../context";
import { fatal } from "../errors";
import { printJson } from "../output";
import { readSecretInput } from "../secret-input";
import type { CliConfig } from "../types";

type AppCommandContext = {
  client: AomiClient;
  sessionId: string;
  agentMode: "auto" | "direct";
  app?: string;
  applicationId?: string;
};

type CredentialWriteOptions = {
  readSecret?: (prompt: string) => Promise<string>;
  replace?: boolean;
};

function commandContext(config: CliConfig): AppCommandContext {
  const cli = CliSession.loadOrCreate(config);
  return {
    client: createControlClient({
      ...config,
      baseUrl: config.baseUrl ?? cli.baseUrl,
      apiKey: config.apiKey ?? cli.apiKey,
    }),
    sessionId: cli.sessionId,
    agentMode: cli.agentMode,
    app: cli.app,
    applicationId: cli.applicationId,
  };
}

function appId(app: AomiAppDescriptor): number | string | null {
  return app.applicationId ?? null;
}

async function resolveAccountApp(
  context: AppCommandContext,
  selector: string,
): Promise<AomiAppDescriptor> {
  const apps = await context.client.listAccountApps(context.sessionId);
  const matches = apps.filter(
    (app) => app.name === selector || String(appId(app) ?? "") === selector,
  );
  if (matches.length === 0) fatal(`App "${selector}" was not found.`);
  if (matches.length > 1) {
    fatal(
      `App name "${selector}" is ambiguous. Use an application ID: ${matches
        .map((app) => String(appId(app) ?? "unknown"))
        .join(", ")}`,
    );
  }
  return matches[0];
}

function requireApplicationId(app: AomiAppDescriptor): number | string {
  const id = appId(app);
  if (id == null) {
    fatal(`App "${app.name}" does not expose an application ID.`);
  }
  return id;
}

export async function accountAppsCommand(config: CliConfig): Promise<void> {
  const context = commandContext(config);
  const catalog = await context.client.listAccountApps(context.sessionId);
  const rows = catalog.map((app) => ({
    name: app.name,
    applicationId: appId(app),
    installed: app.isInstalled === true,
    current:
      context.agentMode === "direct" &&
      (context.applicationId != null && appId(app) != null
        ? String(context.applicationId) === String(appId(app))
        : context.applicationId == null && context.app === app.name),
  }));

  if (config.json) {
    printJson(rows);
    return;
  }
  if (rows.length === 0) {
    console.log("No account apps available.");
    return;
  }
  for (const row of rows) {
    const id = row.applicationId == null ? "" : `  id=${row.applicationId}`;
    const status = row.installed ? "  installed" : "";
    const current = row.current ? "  current" : "";
    console.log(`${row.name}${id}${status}${current}`);
  }
}

async function updateInstalledApp(
  config: CliConfig,
  selector: string,
  install: boolean,
): Promise<void> {
  const context = commandContext(config);
  const app = await resolveAccountApp(context, selector);
  const applicationId = requireApplicationId(app);
  const result = install
    ? await context.client.addAccountApp(context.sessionId, applicationId)
    : await context.client.removeAccountApp(context.sessionId, applicationId);
  if (config.json) {
    printJson(result);
    return;
  }
  console.log(`${app.name} ${install ? "added" : "removed"}.`);
}

export function addAccountAppCommand(
  config: CliConfig,
  selector: string,
): Promise<void> {
  return updateInstalledApp(config, selector, true);
}

export function removeAccountAppCommand(
  config: CliConfig,
  selector: string,
): Promise<void> {
  return updateInstalledApp(config, selector, false);
}

function credentialRows(status: AomiUserAppSecrets) {
  return status.slots.map((slot) => ({
    name: slot.name,
    description: slot.description,
    required: slot.required,
    configured: slot.configured,
  }));
}

export async function appCredentialStatusCommand(
  config: CliConfig,
  selector: string,
): Promise<void> {
  const context = commandContext(config);
  const app = await resolveAccountApp(context, selector);
  const status = await context.client.getAppCredentialsStatus(
    context.sessionId,
    requireApplicationId(app),
  );
  if (config.json) {
    printJson({
      app: status.app,
      applicationId: status.application_id,
      ready: status.ready,
      missingRequired: status.missing_required,
      slots: credentialRows(status),
    });
    return;
  }
  console.log(
    `${status.app} credentials: ${status.ready ? "ready" : "setup required"}`,
  );
  for (const slot of credentialRows(status)) {
    console.log(
      `${slot.name}  ${slot.required ? "required" : "optional"}  ${
        slot.configured ? "saved" : "missing"
      }${slot.description ? `  ${slot.description}` : ""}`,
    );
  }
}

export async function setAppCredentialCommand(
  config: CliConfig,
  selector: string,
  name: string,
  options: CredentialWriteOptions = {},
): Promise<void> {
  const context = commandContext(config);
  const app = await resolveAccountApp(context, selector);
  const id = requireApplicationId(app);
  const before = await context.client.getAppCredentialsStatus(
    context.sessionId,
    id,
  );
  const slot = before.slots.find((candidate) => candidate.name === name);
  if (!slot) fatal(`Credential "${name}" is not declared by ${app.name}.`);
  if (options.replace && !slot.configured) {
    fatal(`Credential "${name}" is not saved yet. Use "set" first.`);
  }
  const readSecret = options.readSecret ?? readSecretInput;
  const value = await readSecret(`${app.name} ${name}: `);
  const after = options.replace
    ? await context.client.replaceAppCredential(
        context.sessionId,
        id,
        name,
        value,
      )
    : await context.client.setAppCredential(context.sessionId, id, name, value);
  if (config.json) {
    printJson({
      app: after.app,
      applicationId: after.application_id,
      name,
      configured: true,
      ready: after.ready,
    });
    return;
  }
  console.log(
    `${name} ${options.replace ? "replaced" : "saved"} for ${app.name}.`,
  );
}

export async function removeAppCredentialCommand(
  config: CliConfig,
  selector: string,
  name: string,
): Promise<void> {
  const context = commandContext(config);
  const app = await resolveAccountApp(context, selector);
  const deleted = await context.client.removeAppCredential(
    context.sessionId,
    requireApplicationId(app),
    name,
  );
  if (config.json) {
    printJson({ app: app.name, name, deleted: deleted.deleted });
    return;
  }
  console.log(
    deleted.deleted
      ? `${name} removed from ${app.name}.`
      : `${name} was not saved for ${app.name}.`,
  );
}
