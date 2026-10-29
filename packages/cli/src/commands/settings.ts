import {
  CHAIN_NAMES,
  SUPPORTED_CHAIN_IDS,
  secretNamesFrom,
} from "@aomi-labs/client";
import {
  baseUrlOf,
  clientIdOf,
  connect,
  json,
  out,
  usage,
  type ConnectFlags,
} from "../context";
import { loadState, updateState } from "../state";
import { readSecret } from "./apps";

type Flags = ConnectFlags & { json?: boolean };

const threadOf = () => loadState().thread ?? crypto.randomUUID();

export async function models(flags: Flags): Promise<void> {
  const aomi = await connect(flags);
  const current = loadState().model;
  const names = await aomi.raw.getModels(threadOf());
  if (flags.json) return names.forEach((name) => json(name));
  for (const name of names) out(`${name === current ? "*" : " "} ${name}`);
}

export async function setModel(_flags: Flags, model: string): Promise<void> {
  updateState({ model });
  out(`Model ${model}`);
}

export async function currentModel(): Promise<void> {
  out(loadState().model ?? "(the backend default)");
}

export async function chains(flags: Flags): Promise<void> {
  const current = loadState().chain;
  for (const id of SUPPORTED_CHAIN_IDS)
    if (flags.json) json({ id, name: CHAIN_NAMES[id] });
    else
      out(
        `${id === current ? "*" : " "} ${String(id).padEnd(9)} ${CHAIN_NAMES[id]}`,
      );
}

export async function setChain(_flags: Flags, chain: number): Promise<void> {
  if (!(SUPPORTED_CHAIN_IDS as readonly number[]).includes(chain))
    throw usage(`Unsupported chain ${chain}; aomi chain list`);
  updateState({ chain });
  out(`Chain ${chain} (${CHAIN_NAMES[chain]})`);
}

export async function currentChain(): Promise<void> {
  const chain = loadState().chain;
  out(chain ? `${chain} (${CHAIN_NAMES[chain] ?? "unknown"})` : "(none)");
}

/** The secrets vault holds both: provider keys are `BYOK:<provider>`. */
async function vault(flags: Flags) {
  const aomi = await connect(flags);
  const thread = threadOf();
  const clientId = clientIdOf();
  return {
    names: async () =>
      secretNamesFrom(await aomi.raw.listSecrets(thread, clientId)),
    add: (secrets: Record<string, string>) =>
      aomi.raw.ingestSecrets(thread, clientId, secrets),
    remove: (name: string) => aomi.raw.deleteSecret(thread, clientId, name),
    clear: () => aomi.raw.clearSecrets(thread, clientId),
  };
}

const BYOK = "BYOK:";

export async function keys(flags: Flags): Promise<void> {
  const names = (await (await vault(flags)).names()).filter((name) =>
    name.startsWith(BYOK),
  );
  for (const name of names) out(name.slice(BYOK.length));
  if (!names.length && !flags.json)
    out("No provider keys; aomi keys set <provider>");
}

/** Your own provider key (e.g. `anthropic`), read from stdin or a hidden prompt. */
export async function setKey(flags: Flags, provider: string): Promise<void> {
  const key = await readSecret(`${provider} key: `);
  await (await vault(flags)).add({ [`${BYOK}${provider}`]: key });
  out(`${provider} key saved`);
}

export async function removeKey(flags: Flags, provider: string): Promise<void> {
  await (await vault(flags)).remove(`${BYOK}${provider}`);
  out(`${provider} key removed`);
}

export async function secrets(flags: Flags): Promise<void> {
  const names = (await (await vault(flags)).names()).filter(
    (name) => !name.startsWith(BYOK),
  );
  for (const name of names) flags.json ? json(name) : out(name);
}

/** `aomi secret add NAME=value …`: values the agent's tools can use by handle. */
export async function addSecrets(
  flags: Flags,
  ...pairs: string[]
): Promise<void> {
  const secrets = Object.fromEntries(
    pairs.map((pair) => {
      const at = pair.indexOf("=");
      if (at < 1) throw usage(`Expected NAME=value, got ${pair}`);
      return [pair.slice(0, at), pair.slice(at + 1)];
    }),
  );
  const { handles } = await (await vault(flags)).add(secrets);
  for (const [name, handle] of Object.entries(handles))
    out(`${name}  ${handle}`);
}

export async function clearSecrets(flags: Flags): Promise<void> {
  await (await vault(flags)).clear();
  out("Secrets cleared");
}

export async function config(flags: Flags): Promise<void> {
  const state = loadState();
  const view = {
    backend: baseUrlOf(flags, state),
    thread: state.thread ?? null,
    model: state.model ?? null,
    chain: state.chain ?? null,
  };
  if (flags.json) return json(view);
  for (const [key, value] of Object.entries(view))
    out(`${key.padEnd(8)} ${value ?? "-"}`);
}

export async function setBackend(_flags: Flags, url: string): Promise<void> {
  const baseUrl = new URL(url).origin;
  updateState({ baseUrl, thread: undefined });
  out(`Backend ${baseUrl}`);
}
