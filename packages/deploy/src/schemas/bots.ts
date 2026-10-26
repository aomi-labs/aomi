/** Bots and builder model keys. */
import { z } from "zod";

import { flag, list, maybeNum, maybeText, num, strict, strings, text, wire } from "./wire";

const BotRegistrationApp = wire(
  {
    applicationId: num(0),
    projectId: maybeNum,
    projectLabel: maybeText,
    name: text(),
    label: text(),
    platform: maybeText,
    isPrimary: flag,
  },
  { label: ["name"] },
);
export type BotRegistrationApp = z.output<typeof BotRegistrationApp>;

export const BotRegistration = wire({
  id: text(),
  platform: text(),
  status: text(),
  label: maybeText,
  /** The app a new chat starts on; also picks the operating account for a handover. */
  handoverApp: text(),
  handoverAppId: num(0),
  /** null = the Aomi platform default, resolved by the manager at read time. */
  miniAppUrl: maybeText,
  /** null = custom commands unsupported. Commands post to `{commandEndpoint}/{command}`. */
  commandEndpoint: maybeText,
  commands: strings,
  apps: list(BotRegistrationApp),
  platformBotId: text(),
  platformUsername: maybeText,
  webhookUrl: maybeText,
  threadMode: text("single"),
  /** Bumped on every registration change, so a refreshed bot tells apart from a re-fetched one. */
  configurationVersion: num(0),
  createdAt: num(0),
});
export type BotRegistration = z.output<typeof BotRegistration>;

/** A registration save, plus the warning when the webhook could not be re-asserted after it. */
export type UpdateUserBotResult = BotRegistration & { webhookWarning?: string };

/** Rejects a report missing its comparison or count rather than inventing a "not matching,
 *  nothing pending" status the UI would show as fact. */
export const BotWebhookStatus = strict(
  wire({
    urlMatches: z.boolean(),
    pendingUpdateCount: z.number(),
    lastErrorMessage: maybeText,
    /** A mismatch was found and the manager re-asserted the webhook. */
    reasserted: flag,
    /** A mismatch was found but re-asserting failed. */
    warning: maybeText,
  }),
  "backend response is missing the webhook status",
);
export type BotWebhookStatus = z.output<typeof BotWebhookStatus>;

/** All-time funded-turn rollup for a key. `costCredits` is the model cost the platform would
 *  have charged (1 credit = $0.01); funded turns record it though the user was charged 0. */
const usage = { inputTokens: num(0), outputTokens: num(0), costCredits: num(0), turns: num(0) };
export const BuilderModelKeyUsage = wire(usage);
export type BuilderModelKeyUsage = z.output<typeof BuilderModelKeyUsage>;

const Grant = z.object({ applicationId: z.number(), keyId: z.number(), modelIds: z.union([z.literal("*"), z.array(z.string())]) });

/** A builder-owned LLM model key: provider, recognizable prefix and the applications it is
 *  granted to. Never carries key material. */
export const BuilderModelKey = wire({
  id: num(),
  provider: text(),
  label: maybeText,
  keyPrefix: text(),
  grants: z.unknown().transform((value) => (Array.isArray(value) ? value : []) as z.output<typeof Grant>[]),
  createdAt: num(0),
  updatedAt: num(0),
  applicationIds: list(z.unknown().transform(Number)),
  usage: BuilderModelKeyUsage,
  usageByApplication: list(wire({ applicationId: num(), ...usage })),
});
export type BuilderModelKey = z.output<typeof BuilderModelKey>;
