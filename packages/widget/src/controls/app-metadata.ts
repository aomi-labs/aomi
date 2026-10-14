/** Compatibility exports for app presentation and category grouping. */

import type { AomiAppDescriptor } from "@aomi-labs/client";
import {
  APP_CATEGORIES,
  resolveAppIdentity,
  type AppCategoryInfo,
  type AppInfo,
} from "@/lib/apps/app-identity";

export {
  APP_CATEGORIES,
  CURATED_APP_IDS,
  canonicalAppId,
  resolveAppIdentity,
  type AppCategoryInfo,
  type AppInfo,
} from "@/lib/apps/app-identity";

export type AppGroup = {
  category: AppCategoryInfo;
  apps: AppInfo[];
};

/** @deprecated Prefer resolveAppIdentity for new consumers. */
export function getAppInfo(appId: string | null | undefined): AppInfo {
  const legacyId = (appId ?? "").trim().toLowerCase() || "unknown";
  return { ...resolveAppIdentity(appId ?? ""), id: legacyId };
}

export function groupAppsByCategory(
  apps: Array<string | AomiAppDescriptor>,
): AppGroup[] {
  const grouped = new Map<string, AppInfo[]>();

  for (const app of apps) {
    const name =
      typeof app === "string"
        ? app
        : app && typeof app.name === "string"
          ? app.name
          : "";
    if (name.trim().length === 0) continue;

    const info = resolveAppIdentity(app);
    const existing = grouped.get(info.category.id) ?? [];
    existing.push(info);
    grouped.set(info.category.id, existing);
  }

  return Array.from(grouped.values())
    .map((groupApps) => ({
      category: groupApps[0]?.category ?? APP_CATEGORIES.custom,
      apps: groupApps.sort((a, b) =>
        a.displayName.localeCompare(b.displayName, undefined, {
          numeric: true,
          sensitivity: "base",
        }),
      ),
    }))
    .sort(
      (a, b) =>
        a.category.order - b.category.order ||
        a.category.label.localeCompare(b.category.label),
    );
}
