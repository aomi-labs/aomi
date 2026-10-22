import type { ArgsDef, CommandDef, Resolvable } from "citty";
import { globalArgs } from "./commands/defs/shared";

async function resolve<T>(value: Resolvable<T>): Promise<T> {
  return typeof value === "function"
    ? await (value as () => T | Promise<T>)()
    : await value;
}

/** Citty drops options preceding each subcommand; carry them to the leaf. */
export async function forwardGlobalOptions<T extends ArgsDef>(
  command: CommandDef<T>,
  rawArgs: string[],
  inherited: string[] = [],
): Promise<string[]> {
  const definitions: ArgsDef = { ...globalArgs, ...(await resolve(command.args ?? {})) };
  const subcommands = await resolve(command.subCommands ?? {});
  const prefix: string[] = [];
  const forwarded = [...inherited];
  for (let index = 0; index < rawArgs.length; index++) {
    const token = rawArgs[index]!;
    if (token === "--" || !token.startsWith("-")) {
      const child = subcommands[token];
      if (!child || token === "--")
        return [...forwarded, ...prefix, ...rawArgs.slice(index)];
      return [
        ...prefix,
        token,
        ...(await forwardGlobalOptions(
          await resolve(child),
          rawArgs.slice(index + 1),
          forwarded,
        )),
      ];
    }
    const name = token.split("=", 1)[0]!.replace(/^-{1,2}/, "");
    const definition = Object.entries(definitions).find(
      ([key, value]) =>
        key === name ||
        (name === `no-${key}` && value.type === "boolean") ||
        ("alias" in value &&
          (Array.isArray(value.alias) ? value.alias : [value.alias]).includes(name)),
    );
    const tokens = [token];
    if (
      !token.includes("=") &&
      definition?.[1].type === "string" &&
      index + 1 < rawArgs.length
    )
      tokens.push(rawArgs[++index]!);
    const isGlobal =
      definition &&
      Object.prototype.hasOwnProperty.call(globalArgs, definition[0]);
    (isGlobal ? forwarded : prefix).push(...tokens);
  }
  return [...forwarded, ...prefix];
}
