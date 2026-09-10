"use client";

/** Guests browse the public app catalog; signed-in users see their available
 * apps. Installed-app writes always use the authenticated account endpoint. */

import {
  normalizeAppDescriptor,
  type AomiAppDescriptor,
} from "@aomi-labs/client";
import { accountScopedFetch } from "@portal/lib/settings-api";

export async function fetchAppCatalog(
  accountUserId?: string,
): Promise<AomiAppDescriptor[]> {
  const rows = await accountScopedFetch<unknown[]>(
    accountUserId ? "/api/account/apps" : "/api/thread/apps",
  );
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
