import { readFile } from "node:fs/promises";
import type { PipelineDirectory } from "@aomi-labs/client";
import { connect, err, json, out, usage, type ConnectFlags } from "../context";
import { commitEvent, commitHint } from "./chat";

type Flags = ConnectFlags & {
  json?: boolean;
  agent?: string;
  package?: string;
  filter?: string;
};

function printDirectory(flags: Flags, directory: PipelineDirectory) {
  const entries = directory.entries.filter(
    (entry) => !flags.filter || entry.name.includes(flags.filter),
  );
  if (flags.json) return entries.forEach(json);
  for (const entry of entries)
    out(`${entry.name}${entry.description ? `  ${entry.description}` : ""}`);
}

function scope(aomi: Awaited<ReturnType<typeof connect>>, flags: Flags) {
  if (flags.agent && flags.package) throw usage("Choose --agent or --package");
  return flags.package
    ? aomi.pipeline.skill(flags.package)
    : aomi.pipeline.toolset(flags.agent ?? "default");
}

/** A JSON object, a file, @file, or - for stdin. */
async function readArgs(input?: string): Promise<Record<string, unknown>> {
  if (!input) return {};
  const text =
    input === "-"
      ? await new Response(process.stdin as unknown as ReadableStream).text()
      : input.trim().startsWith("{")
        ? input
        : await readFile(input.replace(/^@/, ""), "utf8");
  const value: unknown = JSON.parse(text);
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw usage("Arguments must be a JSON object");
  return value as Record<string, unknown>;
}

export async function operations(flags: Flags): Promise<void> {
  const aomi = await connect(flags);
  printDirectory(flags, await scope(aomi, flags).operations());
}

export async function operation(flags: Flags, name: string): Promise<void> {
  const aomi = await connect(flags);
  json(await scope(aomi, flags).operation(name));
}

export async function agents(flags: Flags): Promise<void> {
  const aomi = await connect(flags);
  printDirectory(flags, await aomi.pipeline.raw.toolsets.list());
}

export async function packages(flags: Flags): Promise<void> {
  const aomi = await connect(flags);
  printDirectory(flags, await aomi.pipeline.skills.list());
}

export async function describePackage(
  flags: Flags & { instructions?: boolean },
  name: string,
): Promise<void> {
  const aomi = await connect(flags);
  const selected = aomi.pipeline.skill(name);
  if (flags.instructions)
    return void process.stdout.write(await selected.instructions());
  printDirectory(flags, await selected.directory());
}

export async function invoke(
  flags: Flags & { idempotencyKey?: string },
  name: string,
  args?: string,
): Promise<void> {
  const aomi = await connect(flags);
  json(
    await scope(aomi, flags).invoke(name, await readArgs(args), {
      idempotencyKey: flags.idempotencyKey,
    }),
  );
}

/** Stage and simulate; with --commit, also make the commit to sign. */
export async function build(
  flags: Flags & { commit?: boolean; chainFamily?: "evm" | "svm" },
  name: string,
  args?: string,
): Promise<void> {
  const aomi = await connect(flags);
  const built = await aomi.pipeline.build(name, await readArgs(args), {
    toolset: flags.agent,
    chainFamily: flags.chainFamily,
  });
  if (flags.json) json({ type: "build", ...built.raw.toJSON() });
  else {
    out(
      `Build ${built.digest}  ${built.chainFamily}  expires ${new Date(built.expiresAt).toISOString()}`,
    );
    for (const change of built.balanceChanges)
      out(`Balance   ${JSON.stringify(change)}`);
    for (const approval of built.approvals)
      out(`Approval  ${JSON.stringify(approval)}`);
  }
  if (!flags.commit) return;
  const commit = await built.commit();
  try {
    if (flags.json) json({ type: "commit", ...commitEvent(commit) });
    else err(commitHint(commit, Boolean(process.stderr.isTTY)));
    process.exitCode = 3;
  } finally {
    commit.close();
  }
}
