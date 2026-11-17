/** Channels and builder model keys. */
import { z } from "zod";

import {
  flag,
  list,
  maybeNum,
  maybeText,
  num,
  strict,
  strings,
  text,
  wire,
} from "./wire";

const ChannelAgent = wire({
  id: num(),
  name: text(),
  displayName: text(),
  projectId: maybeNum,
  projectLabel: maybeText,
  platform: maybeText,
});
export type ChannelAgent = z.output<typeof ChannelAgent>;

export const Channel = wire({
  id: text(),
  kind: text(),
  status: text(),
  label: maybeText,
  agentId: num(),
  agent: ChannelAgent,
  miniAppUrl: maybeText,
  miniAppLabel: maybeText,
  commandEndpoint: maybeText,
  commands: strings,
  externalBotId: text(),
  platformUsername: maybeText,
  webhookUrl: maybeText,
  threadMode: text("single"),
  configurationVersion: num(0),
  createdAt: num(0),
});
export type Channel = z.output<typeof Channel>;

/** A registration save, plus the warning when the webhook could not be re-asserted after it. */
export type UpdateUserChannelResult = Channel & { webhookWarning?: string };

/** Rejects a report missing its comparison or count rather than inventing a "not matching,
 *  nothing pending" status the UI would show as fact. */
export const ChannelWebhookStatus = strict(
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
export type ChannelWebhookStatus = z.output<typeof ChannelWebhookStatus>;

/** All-time funded-turn rollup for a key. `costCredits` is the model cost the platform would
 *  have charged (1 credit = $0.01); funded turns record it though the user was charged 0. */
const usage = {
  inputTokens: num(0),
  outputTokens: num(0),
  costCredits: num(0),
  turns: num(0),
};
export const BuilderModelKeyUsage = wire(usage);
export type BuilderModelKeyUsage = z.output<typeof BuilderModelKeyUsage>;

const Grant = z.object({
  agentId: z.number(),
  keyId: z.number(),
  modelIds: z.union([z.literal("*"), z.array(z.string())]),
});

/** A builder-owned LLM model key: provider, recognizable prefix and the agents it is
 *  granted to. Never carries key material. */
export const BuilderModelKey = wire({
  id: num(),
  provider: text(),
  label: maybeText,
  keyPrefix: text(),
  grants: z
    .unknown()
    .transform(
      (value) =>
        (Array.isArray(value) ? value : []) as z.output<typeof Grant>[],
    ),
  createdAt: num(0),
  updatedAt: num(0),
  agentIds: list(z.unknown().transform(Number)),
  usage: BuilderModelKeyUsage,
  usageByAgent: list(wire({ agentId: num(), ...usage })),
});
export type BuilderModelKey = z.output<typeof BuilderModelKey>;
