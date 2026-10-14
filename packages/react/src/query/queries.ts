import {
  normalizeAppDescriptor,
  type AomiAppDescriptor,
  type AomiClient,
  type AomiCreditPosition,
  type AomiPlatformFilter,
} from "@aomi-labs/client";
import type { DisplayQuery } from "./display-cache";

const platformKey = (platforms?: AomiPlatformFilter) =>
  Array.isArray(platforms) ? platforms.join("\0") : (platforms ?? "");

const normalizedApps = (rows: unknown[]) =>
  rows
    .map(normalizeAppDescriptor)
    .filter((app): app is AomiAppDescriptor => app !== null);

/** Display reads the runtime loads through AomiClient. */
export const displayQueries = {
  models: (api: AomiClient): DisplayQuery<string[]> => ({
    resource: "models",
    fetcher: (signal) => api.getPublicCatalog<string[]>("models", { signal }),
  }),
  appCatalog: (
    api: AomiClient,
    platforms?: AomiPlatformFilter,
  ): DisplayQuery<AomiAppDescriptor[]> => ({
    resource: "app-catalog",
    parameters: [platformKey(platforms)],
    fetcher: async (signal) =>
      normalizedApps(
        await api.getPublicCatalog<unknown[]>("apps", { signal, platforms }),
      ),
  }),
  /** Models this app key or account may use. `credential` changes with the key. */
  authorizedModels: (
    api: AomiClient,
    input: { sessionId: () => string; appId: string; credential: number },
  ): DisplayQuery<string[]> => ({
    resource: "authorized-models",
    parameters: [input.appId, input.credential],
    fetcher: (signal) =>
      api.getModels(input.sessionId(), { applicationId: input.appId, signal }),
  }),
  authorizedApps: (
    api: AomiClient,
    input: {
      sessionId: () => string;
      appId: string;
      credential: number;
      apiKey: () => string | null;
      platforms?: AomiPlatformFilter;
    },
  ): DisplayQuery<AomiAppDescriptor[]> => ({
    resource: "authorized-apps",
    parameters: [input.appId, platformKey(input.platforms), input.credential],
    fetcher: (signal) =>
      api.getApps(input.sessionId(), {
        apiKey: input.apiKey() ?? undefined,
        platforms: input.platforms,
        applicationId: input.appId,
        signal,
      }),
  }),
  credits: (
    api: AomiClient,
    enabled = true,
  ): DisplayQuery<AomiCreditPosition> => ({
    resource: "credits",
    enabled,
    fetcher: (signal) => api.account.credits.get({ limit: 25, signal }),
  }),
};
