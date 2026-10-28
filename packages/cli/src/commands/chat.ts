import { Turn, type CommitHandle } from "@aomi-labs/client";
import { decode } from "@aomi-labs/client/trace";
import {
  CliError,
  connect,
  err,
  json,
  out,
  ownerOf,
  turnOptions,
  usage,
  type ConnectFlags,
} from "../context";
import { loadState, updateState } from "../state";
import { chipsOf, paint, statusOf, stepLine } from "../trace";

export type ChatFlags = ConnectFlags & {
  prompt?: string;
  thread?: string;
  new?: boolean;
  app?: string;
  model?: string;
  json?: boolean;
};

/** `aomi chat [message]`, `aomi -p`: one turn, or the chat screen without one. */
export async function chat(flags: ChatFlags, message?: string): Promise<void> {
  const text = (flags.prompt ?? message)?.trim();
  if (text) return ask(flags, text);
  if (!process.stdin.isTTY || !process.stdout.isTTY)
    throw usage('No terminal for the chat screen; use aomi -p "<message>"');
  const { runTui } = await import("../tui/chat");
  await runTui(flags);
}

/** Trace on stderr, the reply on stdout; `--json` makes stdout NDJSON. */
export async function ask(flags: ChatFlags, text: string): Promise<void> {
  const aomi = await connect(flags);
  const options = turnOptions(aomi, loadState(), {
    ...flags,
    thread: flags.new ? crypto.randomUUID() : flags.thread,
  });
  const turn = new Turn(aomi.agent.run(text, options), (ref) =>
    aomi.commits.get(ref),
  );
  const stop = () => void turn.interrupt();
  process.once("SIGINT", stop);
  const color = Boolean(process.stderr.isTTY);
  let steps = 0;
  try {
    for await (const step of turn.steps({ decode })) {
      steps += 1;
      if (flags.json)
        json({
          type: "step",
          status: statusOf(step),
          icon: step.icon,
          title: step.title,
          chips: chipsOf(step),
        });
      else err(stepLine(step, color));
    }
    const result = await turn;
    updateState({ thread: result.threadId, owner: ownerOf(aomi) });
    if (flags.json) {
      json({ type: "reply", thread: result.threadId, text: result.reply });
      for (const commit of result.commits)
        json({ type: "commit", ...commitEvent(commit) });
    } else {
      if (steps && result.reply) err();
      if (result.reply) out(result.reply);
      for (const commit of result.commits) err(commitHint(commit, color));
    }
    for (const commit of result.commits) commit.close();
    if (result.state === "interrupted") throw new CliError("Interrupted");
    if (result.commits.length) process.exitCode = 3;
    else if (!result.reply) throw new CliError("The agent returned no reply");
  } finally {
    process.off("SIGINT", stop);
  }
}

export function commitEvent(commit: CommitHandle) {
  return {
    ref: commit.ref,
    kind: commit.kind,
    state: commit.state,
    signUrl: commit.signUrl,
  };
}

/** What a commit waits for, and the command that does it. */
export function commitHint(commit: CommitHandle, color: boolean): string {
  const [label, command] =
    commit.state === "awaiting_approval"
      ? ["Waiting for you", `aomi tx approve ${commit.ref}`]
      : ["Sign it", `aomi tx sign ${commit.ref}`];
  const head = `\n${color ? paint.yellow(label) : label}  ${command}`;
  if (!commit.signUrl) return head;
  return `${head}\n${color ? paint.dim(commit.signUrl) : commit.signUrl}`;
}
