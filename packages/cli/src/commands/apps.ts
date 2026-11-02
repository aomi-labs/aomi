import { readFileSync } from "node:fs";
import { resolveAppIdentity } from "@aomi-labs/client";
import { connect, json, out, usage, type ConnectFlags } from "../context";
import { loadState } from "../state";

type Flags = ConnectFlags & { json?: boolean };

/** An app by name, or by its numeric id (`aomi apps list --json` shows it). */
const appRef = (app: string) => (/^\d+$/.test(app) ? Number(app) : app);

/** `aomi apps`: every app the account can use. */
export async function list(flags: Flags): Promise<void> {
  const aomi = await connect(flags);
  const apps = await aomi.account.apps.list();
  if (flags.json) return apps.forEach(json);
  // Shown as in the app; the name is what the other commands take.
  for (const app of apps)
    out(
      `${resolveAppIdentity(app).displayName.padEnd(22)} ${app.name}${app.isInstalled ? "  installed" : ""}`,
    );
}

export async function install(flags: Flags, name: string): Promise<void> {
  const aomi = await connect(flags);
  const result = await aomi.account.apps.install(appRef(name));
  if (flags.json) return json(result);
  out(`Installed ${result.app}`);
}

export async function uninstall(flags: Flags, name: string): Promise<void> {
  const aomi = await connect(flags);
  const result = await aomi.account.apps.uninstall(appRef(name));
  if (flags.json) return json(result);
  out(`Uninstalled ${result.app}`);
}

/** The credential slots an app declares (never their values). */
export async function credentials(flags: Flags, name: string): Promise<void> {
  const aomi = await connect(flags);
  const status = await aomi.account.apps.credentials(appRef(name)).list();
  if (flags.json) return json(status);
  for (const slot of status.slots)
    out(
      `${slot.name}  ${slot.configured ? "set" : slot.required ? "missing" : "optional"}  ${slot.description}`,
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
  const status = await aomi.account.apps
    .credentials(appRef(name))
    .set(key, value);
  if (flags.json) return json(status);
  out(
    `${key} set${status.ready ? "" : `; still missing ${status.missing_required.join(", ")}`}`,
  );
}

export async function removeCredential(
  flags: Flags,
  name: string,
  key: string,
): Promise<void> {
  const aomi = await connect(flags);
  await aomi.account.apps.credentials(appRef(name)).remove(key);
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
