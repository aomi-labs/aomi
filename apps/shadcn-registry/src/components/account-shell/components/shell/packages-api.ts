"use client";

/** Guests browse the public app catalog; signed-in users see their available
 * apps. Installed-app writes always use the authenticated account endpoint. */

import {
  normalizeAppDescriptor,
  type AomiAppDescriptor,
  type AomiDeleteSecretResponse,
  type AomiUserAppSecrets,
} from "@aomi-labs/client";
import type { ShellRequest } from "../../transport";
import { accountScopedFetch } from "../../lib/settings-api";

export async function fetchAppCatalog(
  accountUserId?: string,
  request: ShellRequest = accountScopedFetch,
): Promise<AomiAppDescriptor[]> {
  const rows = await request<unknown[]>(
    accountUserId ? "/api/account/apps" : "/api/thread/apps",
  );
  return rows
    .map(normalizeAppDescriptor)
    .filter((app): app is AomiAppDescriptor => app !== null);
}

export async function setInstalledApps(
  apps: string[],
  request: ShellRequest = accountScopedFetch,
): Promise<string[]> {
  const response = await request<{ apps: string[] }>("/api/account/apps", {
    method: "PUT",
    body: JSON.stringify({ apps }),
  });
  return response.apps;
}

function appSecretsPath(applicationId: number | string): string {
  return `/api/account/apps/${encodeURIComponent(String(applicationId))}/secrets`;
}

export function fetchAppSecrets(
  applicationId: number | string,
  request: ShellRequest = accountScopedFetch,
): Promise<AomiUserAppSecrets> {
  return request(appSecretsPath(applicationId));
}

export function saveAppSecrets(
  applicationId: number | string,
  secrets: Record<string, string>,
  request: ShellRequest = accountScopedFetch,
): Promise<AomiUserAppSecrets> {
  return request(appSecretsPath(applicationId), {
    method: "POST",
    body: JSON.stringify({ secrets }),
  });
}

export function removeAppSecret(
  applicationId: number | string,
  name: string,
  request: ShellRequest = accountScopedFetch,
): Promise<AomiDeleteSecretResponse> {
  return request(
    `${appSecretsPath(applicationId)}/${encodeURIComponent(name)}`,
    { method: "DELETE" },
  );
}
