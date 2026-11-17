import type { Aomi, AomiPackage } from "@aomi-labs/client";
import {
  CliError,
  confirm,
  connect,
  json,
  out,
  usage,
  type ConnectFlags,
} from "../context";

type Flags = ConnectFlags & { json?: boolean };

/** A package by `publisher/name`, or by its numeric id (`--json` shows it). */
async function packageRow(aomi: Aomi, ref: string) {
  const { packages } = await aomi.account.packages.list();
  const row = packages.find((entry) =>
    /^\d+$/.test(ref) ? entry.package_id === Number(ref) : entry.id === ref,
  );
  if (!row) throw usage(`No package ${ref}`);
  return row;
}

const REASONS: Record<AomiPackage["reason"], string> = {
  agent_listed: "the agent lists it",
  verified_default: "on by default",
  chosen_on: "you turned it on",
  chosen_off: "you turned it off",
  off_by_default: "off by default",
};

/** What the live release may reach, in the words the person approves. */
function notice(row: AomiPackage): string[] {
  const { hosts, transactions, signatures } = row.envelope;
  const lines = [`${row.display_name} (${row.id}) may:`];
  lines.push(
    hosts.length ? `  reach ${hosts.join(", ")}` : "  reach no outside hosts",
  );
  if (transactions.length)
    lines.push(`  ask you to approve ${transactions.join(", ")} transactions`);
  for (const signature of signatures)
    lines.push(
      `  ask for ${signature.kind} signatures${signature.primary_types.length ? ` (${signature.primary_types.join(", ")})` : ""}`,
    );
  return lines;
}

/** `aomi packages`: every package in the Library, with whether it is on. */
export async function list(flags: Flags & { thread?: string }): Promise<void> {
  const aomi = await connect(flags);
  const { packages } = await aomi.account.packages.list({
    threadId: flags.thread,
  });
  if (flags.json) return packages.forEach(json);
  for (const row of packages) {
    const missing = row.slots.filter((slot) => slot.status === "missing");
    out(
      `${row.id}  ${row.enabled ? "on" : "off"} (${REASONS[row.reason]})  ${row.verified ? "verified" : "unverified"}  ${row.families.join("+") || "-"}${missing.length ? `  needs ${missing.map((slot) => slot.name).join(", ")}` : ""}`,
    );
  }
}

export async function on(
  flags: Flags & { yes?: boolean },
  ref: string,
): Promise<void> {
  const aomi = await connect(flags);
  const row = await packageRow(aomi, ref);
  if (!flags.yes) {
    for (const line of notice(row)) out(line);
    if (!(await confirm(`Turn on ${row.id}?`)))
      throw new CliError("Not turned on");
  }
  const result = await aomi.account.packages.setChoice(row.package_id, true);
  if (flags.json) return json(result);
  out(`${result.id} is on`);
}

export async function off(flags: Flags, ref: string): Promise<void> {
  const aomi = await connect(flags);
  const row = await packageRow(aomi, ref);
  if (row.agent_listed)
    throw new CliError(`${row.id} stays on: ${REASONS[row.reason]}`);
  const result = await aomi.account.packages.setChoice(row.package_id, false);
  if (flags.json) return json(result);
  out(`${result.id} is off`);
}

/** Drop the choice; the package goes back to its default. */
export async function reset(flags: Flags, ref: string): Promise<void> {
  const aomi = await connect(flags);
  const row = await packageRow(aomi, ref);
  const result = await aomi.account.packages.clearChoice(row.package_id);
  if (flags.json) return json(result);
  out(
    `${result.id} is ${result.enabled ? "on" : "off"} (${REASONS[result.reason]})`,
  );
}

/** The value comes from stdin or a hidden prompt, never the command line. */
export async function connectSlot(
  flags: Flags,
  ref: string,
  slot: string,
): Promise<void> {
  const value = await readSecret(`${slot}: `);
  const aomi = await connect(flags);
  const row = await packageRow(aomi, ref);
  const status = await aomi.account.packages.setSecret(
    row.package_id,
    slot,
    value,
  );
  if (flags.json) return json(status);
  out(`${slot} connected`);
}

export async function disconnectSlot(
  flags: Flags,
  ref: string,
  slot: string,
): Promise<void> {
  const aomi = await connect(flags);
  const row = await packageRow(aomi, ref);
  await aomi.account.packages.clearSecret(row.package_id, slot);
  out(`${slot} disconnected`);
}

export async function readSecret(prompt: string): Promise<string> {
  if (!process.stdin.isTTY) {
    let text = "";
    for await (const chunk of process.stdin) text += chunk;
    const value = text.replace(/\r?\n$/, "");
    if (!value) throw usage("Pipe the value on stdin");
    return value;
  }
  process.stderr.write(prompt);
  const stdin = process.stdin;
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding("utf8");
  return new Promise((resolve, reject) => {
    let value = "";
    const done = (error?: Error) => {
      stdin.off("data", onData);
      stdin.setRawMode(false);
      stdin.pause();
      process.stderr.write("\n");
      if (error) reject(error);
      else if (!value) reject(usage("The value cannot be empty"));
      else resolve(value);
    };
    const onData = (chunk: string) => {
      for (const character of chunk) {
        if (character === "\u0003") return done(usage("Cancelled"));
        if (character === "\r" || character === "\n") return done();
        value =
          character === "\u007f" || character === "\b"
            ? value.slice(0, -1)
            : value + character;
      }
    };
    stdin.on("data", onData);
  });
}
