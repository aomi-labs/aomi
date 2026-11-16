import { readFileSync } from "node:fs";
import type { Aomi } from "@aomi-labs/client";
import { connect, json, out, usage, type ConnectFlags } from "../context";

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

/** `aomi apps`: every package in the Library, with whether it is on. */
export async function list(flags: Flags): Promise<void> {
  const aomi = await connect(flags);
  const { packages } = await aomi.account.packages.list();
  if (flags.json) return packages.forEach(json);
  for (const row of packages)
    out(`${row.display_name.padEnd(22)} ${row.id}${row.enabled ? "  on" : ""}`);
}

export async function install(flags: Flags, name: string): Promise<void> {
  const aomi = await connect(flags);
  const row = await packageRow(aomi, name);
  const result = await aomi.account.packages.setChoice(row.package_id, true);
  if (flags.json) return json(result);
  out(`${result.display_name} is on`);
}

export async function uninstall(flags: Flags, name: string): Promise<void> {
  const aomi = await connect(flags);
  const row = await packageRow(aomi, name);
  const result = await aomi.account.packages.setChoice(row.package_id, false);
  if (flags.json) return json(result);
  out(`${result.display_name} is off`);
}

/** The package's key slots and whether each has a value (never the value). */
export async function credentials(flags: Flags, name: string): Promise<void> {
  const aomi = await connect(flags);
  const row = await packageRow(aomi, name);
  if (flags.json) return json(row.slots);
  for (const slot of row.slots)
    out(
      `${slot.name}  ${slot.owner === "builder" ? "set by the builder" : slot.status}  ${slot.description}`,
    );
}

/** The value comes from stdin or a hidden prompt, never the command line. */
export async function setCredential(
  flags: Flags,
  name: string,
  key: string,
): Promise<void> {
  const value = await readSecret(`${key}: `);
  const aomi = await connect(flags);
  const row = await packageRow(aomi, name);
  const status = await aomi.account.packages.setSecret(
    row.package_id,
    key,
    value,
  );
  if (flags.json) return json(status);
  out(`${key} set`);
}

export async function removeCredential(
  flags: Flags,
  name: string,
  key: string,
): Promise<void> {
  const aomi = await connect(flags);
  const row = await packageRow(aomi, name);
  await aomi.account.packages.clearSecret(row.package_id, key);
  out(`${key} removed`);
}

export async function readSecret(prompt: string): Promise<string> {
  if (!process.stdin.isTTY) {
    const value = readFileSync(0, "utf8").replace(/\r?\n$/, "");
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
