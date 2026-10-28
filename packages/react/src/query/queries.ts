import {
  normalizeAppDescriptor,
  type AomiAppDescriptor,
  type Aomi,
  type CreditBalance,
  type CreditLedger,
  type AomiPlatformFilter,
} from "@aomi-labs/client";
import type { DisplayQuery } from "./display-cache";

const platformKey = (platforms?: AomiPlatformFilter) =>
  Array.isArray(platforms) ? platforms.join("\0") : (platforms ?? "");

const normalizedApps = (rows: unknown[]) =>
  rows
    .map(normalizeAppDescriptor)
    .filter((app): app is AomiAppDescriptor => app !== null);

/** Display reads the runtime loads through its `Aomi`. */
export const displayQueries = {
  models: (aomi: Aomi): DisplayQuery<string[]> => ({
    resource: "models",
    fetcher: (signal) => aomi.raw.getPublicCatalog<string[]>("models", { signal }),
  }),
  appCatalog: (
    aomi: Aomi,
    platforms?: AomiPlatformFilter,
  ): DisplayQuery<AomiAppDescriptor[]> => ({
    resource: "app-catalog",
    parameters: [platformKey(platforms)],
    fetcher: async (signal) =>
      normalizedApps(
        await aomi.raw.getPublicCatalog<unknown[]>("apps", { signal, platforms }),
      ),
  }),
  /** Models this app key or account may use. `credential` changes with the key. */
  authorizedModels: (
    aomi: Aomi,
    input: { sessionId: () => string; appId: string; credential: number },
  ): DisplayQuery<string[]> => ({
    resource: "authorized-models",
    parameters: [input.appId, input.credential],
    fetcher: (signal) =>
      aomi.raw.getModels(input.sessionId(), { applicationId: input.appId, signal }),
  }),
  authorizedApps: (
    aomi: Aomi,
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
      aomi.raw.getApps(input.sessionId(), {
        apiKey: input.apiKey() ?? undefined,
        platforms: input.platforms,
        applicationId: input.appId,
        signal,
      }),
  }),
  credits: (aomi: Aomi, enabled = true): DisplayQuery<CreditBalance> => ({
    resource: "credits",
    enabled,
    fetcher: (signal) => aomi.account.credits.get({ signal }),
  }),
  creditLedger: (
    aomi: Aomi,
    enabled = true,
  ): DisplayQuery<CreditLedger> => ({
    resource: "credit-ledger",
    enabled,
    fetcher: (signal) => aomi.account.credits.ledger({ limit: 25, signal }),
  }),
};
