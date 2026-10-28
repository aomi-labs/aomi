import "@tanstack/react-start/server-only";

/**
 * Node loader hooks that make smithers-orchestrator importable outside Bun.
 *
 * The smithers packages publish Bun-flavored projects: raw .ts files, sibling
 * imports written as ".js", a static `bun:sqlite` import in the createSmithers
 * module (never called on the pglite/postgres backends the web engine uses),
 * and a `bun` import in the MDX plugin. vite.config.ts keeps these packages external so the Node loader — with these hooks — handles them
 * instead of the bundler. Registered before the Start handler loads in src/server.ts.
 */

const REGISTERED_KEY = Symbol.for("aomi-build.bun-compat-hooks");

function dataModule(source: string): string {
  return `data:text/javascript,${encodeURIComponent(source)}`;
}

// Functional bun:sqlite adapter over node:sqlite. Durable run state lives in
// pglite/postgres, but the smithers engine also opens an in-memory scratch
// SQLite for its worker runner (single-runner.js, effect sql-sqlite-bun), so
// the shim must actually work, not just throw. Covers the API surface
// @effect/sql-sqlite-bun and drizzle's bun driver touch.
const BUN_SQLITE_STUB = dataModule(
  `import { DatabaseSync } from "node:sqlite";
function wrapStatement(stmt) {
  return {
    safeIntegers(value) { try { stmt.setReadBigInts(!!value); } catch {} return this; },
    all(...params) { return stmt.all(...params); },
    values(...params) { return stmt.all(...params).map((row) => Object.values(row)); },
    get(...params) { return stmt.get(...params); },
    run(...params) { return stmt.run(...params); },
    finalize() {},
  };
}
export class Database {
  #db;
  constructor(filename, options) {
    this.#db = new DatabaseSync(filename ?? ":memory:", {
      readOnly: options?.readonly ?? false,
    });
  }
  query(sql) { return wrapStatement(this.#db.prepare(sql)); }
  prepare(sql) { return wrapStatement(this.#db.prepare(sql)); }
  run(sql, ...params) {
    if (params.length === 0) { this.#db.exec(sql); return; }
    return this.#db.prepare(sql).run(...params);
  }
  exec(sql) { this.#db.exec(sql); }
  close() { try { this.#db.close(); } catch {} }
  serialize() { throw new Error("bun:sqlite serialize() is not supported by the node:sqlite shim"); }
}
export default { Database };`,
);

const BUN_STUB = dataModule(
  `export function plugin() { throw new Error("Bun.plugin is unavailable on Node — MDX workflow loading needs Bun."); }
export default { plugin };`,
);

export async function registerBunCompatHooks(): Promise<void> {
  const holder = globalThis as { [REGISTERED_KEY]?: boolean; Bun?: unknown };
  if (holder[REGISTERED_KEY]) return;
  holder[REGISTERED_KEY] = true;

  // Polyfill only `Bun.sleep` (0.27 called it unguarded; gone from the 0.28
  // engine/driver/db but kept as cheap insurance) — and NOT `Bun.which`: the
  // 0.28 engine trusts a function-typed `which` with no PATH fallback, so an
  // always-null stub breaks git/claude/codex resolution. Also NOT
  // `Bun.version`, which stays the honest "really running on Bun" signal
  // (packages/smither isBunRuntime keys on it).
  holder.Bun ??= {
    sleep: (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),
  };

  const { registerHooks, stripTypeScriptTypes } = await import("node:module");
  const { readFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");

  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === "bun:sqlite") {
        return { url: BUN_SQLITE_STUB, shortCircuit: true };
      }
      if (specifier === "bun") {
        return { url: BUN_STUB, shortCircuit: true };
      }
      try {
        return nextResolve(specifier, context);
      } catch (error) {
        // Bun packages ship .ts projects but import sibling files as ".js".
        if (
          (error as { code?: string })?.code === "ERR_MODULE_NOT_FOUND" &&
          specifier.endsWith(".js") &&
          context.parentURL?.includes("/node_modules/")
        ) {
          return nextResolve(`${specifier.slice(0, -3)}.ts`, context);
        }
        throw error;
      }
    },
    load(url, context, nextLoad) {
      if (
        url.startsWith("file:") &&
        url.endsWith(".ts") &&
        url.includes("/node_modules/")
      ) {
        const source = readFileSync(fileURLToPath(url), "utf8");
        return {
          format: "module",
          source: stripTypeScriptTypes(source, {
            mode: "transform",
            sourceUrl: url,
          }),
          shortCircuit: true,
        };
      }
      return nextLoad(url, context);
    },
  });
}
