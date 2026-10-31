import type { ThreadSummary } from "@aomi-labs/client";
import { connect, json, out, type ConnectFlags } from "../context";
import { loadState, updateState } from "../state";

type Flags = ConnectFlags & { json?: boolean; limit?: number };

function print(flags: Flags, threads: ThreadSummary[]) {
  if (flags.json) return threads.forEach(json);
  const active = loadState().thread;
  for (const thread of threads)
    out(
      `${thread.id === active ? "*" : " "} ${thread.id}  ${thread.archived ? "archived " : ""}${thread.title || "Untitled chat"}`,
    );
}

export async function list(flags: Flags): Promise<void> {
  const aomi = await connect(flags);
  const { threads } = await aomi.agent.threads.list({
    limit: flags.limit ?? 20,
  });
  print(flags, threads);
}

/** Continue `id` from the next `aomi` or `aomi -p`. */
export async function open(_flags: Flags, id: string): Promise<void> {
  updateState({ thread: id, owner: undefined });
  out(`Continuing ${id}`);
}

/** `aomi threads show [id]`: what you and the agent said (default: the current thread). */
export async function show(flags: Flags, id?: string): Promise<void> {
  const thread = id ?? loadState().thread;
  if (!thread) return out("No thread yet");
  const aomi = await connect(flags);
  const { messages } = await aomi.agent.thread(thread).history();
  if (flags.json) return messages.forEach(json);
  for (const message of messages)
    out(`${message.sender === "user" ? "›" : " "} ${message.text}\n`);
}

/** Start the next message in a new thread. */
export async function start(): Promise<void> {
  updateState({ thread: undefined, owner: undefined });
  out("The next message starts a new thread");
}

export async function rename(
  flags: Flags,
  id: string,
  title: string,
): Promise<void> {
  const aomi = await connect(flags);
  print(flags, [await aomi.agent.thread(id).rename(title)]);
}

export async function archive(flags: Flags, id: string): Promise<void> {
  const aomi = await connect(flags);
  print(flags, [await aomi.raw.agent.sessions.update(id, { archived: true })]);
}
