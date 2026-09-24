import type { ToolMatcher } from "../types";
import type { Descriptor } from "../present/descriptors";
import { aave } from "./aave";
import { aerodrome } from "./aerodrome";
import { circle } from "./circle";
import { jupiter } from "./jupiter";
import { lifi } from "./lifi";
import { morpho } from "./morpho";
import type { ProtocolAdapter } from "./types";
import { uniswap } from "./uniswap";

/** Add one adapter file and register it here; core routing stays untouched. */
const adapters: ProtocolAdapter[] = [
  aave,
  aerodrome,
  circle,
  jupiter,
  lifi,
  morpho,
  uniswap,
];

const matchers = new Map<string, ToolMatcher>();
const descriptors = new Map<string, Descriptor>();
for (const adapter of adapters) {
  for (const name of adapter.tools) {
    if (matchers.has(name)) throw new Error(`Duplicate protocol tool: ${name}`);
    matchers.set(name, adapter.match);
  }
  for (const [id, descriptor] of Object.entries(adapter.descriptors ?? {})) {
    if (descriptors.has(id))
      throw new Error(`Duplicate protocol operation: ${id}`);
    descriptors.set(id, descriptor);
  }
}

export const protocolMatcherFor = (name: string): ToolMatcher | undefined =>
  matchers.get(name);

export const protocolDescriptorFor = (id: string): Descriptor | undefined =>
  descriptors.get(id);
