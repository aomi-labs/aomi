import { isAomiError, type Aomi, type AomiPackage } from "@aomi-labs/client";
import {
  CliError,
  confirm,
  connect,
  err,
  json,
  out,
  usage,
  type ConnectFlags,
} from "../context";
import { plain } from "../trace";

type Flags = ConnectFlags & { json?: boolean; thread?: string };

/** A package by `publisher/name`, or by its numeric id (`--json` shows it). */
async function packageRow(aomi: Aomi, ref: string, threadId?: string) {
  const { packages } = await aomi.account.packages.list({ threadId });
  const row = packages.find((entry) =>
    /^\d+$/.test(ref) ? entry.package_id === Number(ref) : entry.id === ref,
  );
  if (!row) throw usage(`No package ${ref}`);
  return row;
}

const REASONS: Record<AomiPackage["reason"], string> = {
  agent_listed: "the agent lists it",
  agent_default: "on by default",
  chosen_on: "you turned it on",
  chosen_off: "you turned it off",
  off_by_default: "off by default",
};

const FAMILIES = { evm: "EVM", svm: "Solana" };

/** `on (the agent lists it)`. */
export const packageState = (row: AomiPackage) =>
  `${row.enabled ? "on" : "off"} (${REASONS[row.reason]})`;

/** What its guards check, never more than they do; none when nothing is. */
function checkedLine({ checked, verified }: AomiPackage): string | undefined {
  if (!checked || !verified) return undefined;
  const { actions, contracts, evaluator } = checked;
  if (!actions.length) return `checked by ${evaluator ?? "a built-in guard"}`;
  return `checked: ${actions.join(", ")} on ${contracts} contract${contracts === 1 ? "" : "s"}`;
}

/** What the live release may reach, in the words the person approves. */
export function notice(row: AomiPackage): string[] {
  const { hosts, signatures } = row.envelope;
  const lines = [
    `${row.display_name} (${row.id}) may:`,
    hosts.length ? `  reach ${hosts.join(", ")}` : "  reach no outside hosts",
  ];
  if (row.prepares.length)
    lines.push(
      `  prepare ${row.prepares.map((family) => FAMILIES[family]).join(" and ")} transactions`,
    );
  for (const signature of signatures)
    lines.push(
      `  ask for ${signature.kind} signatures${signature.primary_types.length ? ` (${signature.primary_types.join(", ")})` : ""}`,
    );
  const checked = checkedLine(row);
  if (checked) lines.push(`  ${checked}; other calls are partly covered`);
  else if (row.prepares.length || signatures.length)
    lines.push("  no check of its own: what it prepares is partly covered");
  if (!row.verified) lines.push("Not verified by Aomi.");
  return lines.map(plain);
}

/** What the Library's search box and filters keep. */
export function keeps(
  row: AomiPackage,
  filter: { search?: string; chain?: string; tag?: string; on?: boolean },
): boolean {
  const needle = filter.search?.trim().toLowerCase();
  return (
    (!filter.chain || row.chains.includes(filter.chain.toLowerCase())) &&
    (!filter.tag || row.tags.includes(filter.tag.toLowerCase())) &&
    (!filter.on || row.enabled) &&
    (!needle ||
      [
        row.display_name,
        row.id,
        row.description,
        ...row.skills.map((skill) => skill.id),
      ].some((text) => text.toLowerCase().includes(needle)))
  );
}

/** `aomi library`: every package in the Library, with whether it is on. */
export async function list(
  flags: Omit<Flags, "chain"> & {
    search?: string;
    chain?: string;
    tag?: string;
    on?: boolean;
  },
): Promise<void> {
  // `--chain` names a chain here, not the one to sign in on.
  const { chain, ...rest } = flags;
  const aomi = await connect(rest);
  const { packages } = await aomi.account.packages.list({
    threadId: flags.thread,
  });
  const rows = packages.filter((row) => keeps(row, flags));
  if (flags.json) return rows.forEach(json);
  for (const row of rows) {
    const missing = row.slots.filter((slot) => slot.status === "missing");
    out(
      `${row.id}  ${packageState(row)}  ${row.verified ? "verified" : "unverified"}  ${row.chains.join("+") || "-"}${missing.length ? `  needs ${missing.map((slot) => slot.name).join(", ")}` : ""}`,
    );
  }
}

/** One package: what it is, may do and checks, and what is in its release. */
export function packageLines(row: AomiPackage): string[] {
  const section = (title: string, lines: string[]) =>
    lines.length ? ["", title, ...lines.map((line) => `  ${line}`)] : [];
  const named = ({
    name,
    description,
  }: {
    name: string;
    description: string;
  }) => `${name}${description ? `  ${description}` : ""}`;
  return [
    `${row.display_name}  ${row.id}`,
    ...(row.description ? [row.description] : []),
    `${packageState(row)} · ${row.verified ? "verified" : "unverified"} · ${row.live.release === null ? "part of Aomi" : `release ${row.live.release}`}`,
    `Chains  ${row.chains.join(", ") || "any"}${row.tags.length ? `  Tags  ${row.tags.join(", ")}` : ""}`,
    "",
    ...notice(row),
    ...section("Tools", row.tools.map(named)),
    ...section(
      "Instructions",
      row.skills.map((skill) => named({ ...skill, name: skill.id })),
    ),
    ...section(
      "Keys",
      row.slots.map(
        (slot) =>
          `${slot.name}  ${slot.status} (${slot.owner === "person" ? "yours" : "the publisher's"}${slot.required ? "" : ", optional"})`,
      ),
    ),
  ].map(plain);
}

export async function show(flags: Flags, ref: string): Promise<void> {
  const aomi = await connect(flags);
  const row = await packageRow(aomi, ref, flags.thread);
  if (flags.json) return json(row);
  packageLines(row).forEach((line) => out(line));
}

/** Turn `row` on once the person accepts what it may do. */
async function turnOn(
  aomi: Aomi,
  flags: Flags & { yes?: boolean },
  row: AomiPackage,
): Promise<void> {
  if (!flags.yes) {
    for (const line of notice(row)) out(line);
    if (!(await confirm(`Turn on ${row.id}?`)))
      throw new CliError("Not turned on");
  }
  const result = await aomi.account.packages.setChoice(row.package_id, true, {
    threadId: flags.thread,
  });
  if (flags.json) return json(result);
  out(`${result.id} is on`);
}

export async function on(
  flags: Flags & { yes?: boolean },
  ref: string,
): Promise<void> {
  const aomi = await connect(flags);
  await turnOn(aomi, flags, await packageRow(aomi, ref, flags.thread));
}

/** Add a private package with its code. An unverified one asks before it turns on. */
export async function add(flags: Flags & { yes?: boolean }): Promise<void> {
  const code = (await readSecret("Code: ")).trim();
  const aomi = await connect(flags);
  const row = await aomi.account.packages
    .activate(code)
    .catch((error: unknown) => {
      if (isAomiError(error, "code_invalid"))
        throw new CliError("That code isn't valid");
      throw error;
    });
  if (row.enabled) {
    if (flags.json) return json(row);
    return out(`${row.id} is added and on`);
  }
  err(`${row.id} is added, but off`);
  await turnOn(aomi, flags, row);
}

export async function remove(
  flags: Flags & { yes?: boolean },
  ref: string,
): Promise<void> {
  const aomi = await connect(flags);
  const row = await packageRow(aomi, ref);
  if (!row.removable)
    throw new CliError(
      `${row.id} was not added with a code; aomi library off ${row.id}`,
    );
  if (!flags.yes && !(await confirm(removal(row))))
    throw new CliError("Not removed");
  const result = await aomi.account.packages.remove(row.package_id);
  if (flags.json) return json(result);
  out(`${row.id} is removed`);
}

export const removal = (row: AomiPackage) =>
  `Remove ${plain(row.display_name)}? It leaves your Library and your saved keys for it are permanently deleted. Adding it again needs a valid code from its publisher.`;

export async function off(flags: Flags, ref: string): Promise<void> {
  const aomi = await connect(flags);
  const row = await packageRow(aomi, ref, flags.thread);
  if (row.agent_listed)
    throw new CliError(`${row.id} stays on: ${REASONS[row.reason]}`);
  const result = await aomi.account.packages.setChoice(row.package_id, false, {
    threadId: flags.thread,
  });
  if (flags.json) return json(result);
  out(`${result.id} is off`);
}

/** Drop the choice; the package goes back to its default. */
export async function reset(flags: Flags, ref: string): Promise<void> {
  const aomi = await connect(flags);
  const row = await packageRow(aomi, ref, flags.thread);
  const result = await aomi.account.packages.clearChoice(row.package_id, {
    threadId: flags.thread,
  });
  if (flags.json) return json(result);
  out(`${result.id} is ${packageState(result)}`);
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
