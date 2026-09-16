"use client";

/**
 * Wire layer for the Packages catalog.
 *
 * `GET /api/account/apps` is the account-scoped catalog (`AppSpec[]` — every
 * app this account can use). `PUT /api/account/apps` replaces the account's
 * installed set (`users.applications`); it is a full replace, not a delta, so
 * install and remove are the same call and the response is the new truth.
 */

import { normalizeAppDescriptor, type AomiAppDescriptor } from "@aomi-labs/client";
import { accountScopedFetch } from "@portal/lib/settings-api";

export async function fetchAppCatalog(): Promise<AomiAppDescriptor[]> {
  const rows = await accountScopedFetch<unknown[]>("/api/account/apps");
  return rows
    .map(normalizeAppDescriptor)
    .filter((app): app is AomiAppDescriptor => app !== null);
}

export async function setInstalledApps(apps: string[]): Promise<string[]> {
  const response = await accountScopedFetch<{ apps: string[] }>(
    "/api/account/apps",
    { method: "PUT", body: JSON.stringify({ apps }) },
  );
  return response.apps;
}
