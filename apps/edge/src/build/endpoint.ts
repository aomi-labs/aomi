/**
 * One Build control-plane route: who may call it, what it takes, and what it
 * does with a manager client. The handler returns the response body; the
 * endpoint authorizes, validates, answers `no-store` JSON, and leaves every
 * failure (thrown EdgeErrors and manager errors alike) to `failureResponse`.
 */
import type { ManagerClient } from "@aomi-labs/internal";
import { z } from "zod";

import { EdgeError } from "../kernel/errors";
import { parseInput } from "../kernel/route";
import { authorize, type AuthOptions, type Caller } from "./auth";
import type { BuildContext } from "./context";
import { managerClient } from "./manager-client";

/** Platform slug syntax; Manager resolves the platform record. */
export const platformSlug = z.string().trim().regex(/^[a-z0-9][a-z0-9._-]{0,127}$/);

export type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export type Handler = (request: Request, ctx: BuildContext) => Response | Promise<Response>;

export type BuildRoute = {
  operation: string;
  method: Method;
  /** An exact path, or a pattern whose named groups join the input. */
  path: string | RegExp;
  handle: Handler;
};

export type Call<I> = Caller & { input: I; client: ManagerClient; request: Request; ctx: BuildContext };

type Definition<S extends z.ZodType, O> = {
  auth?: AuthOptions;
  input?: S;
  /** The success status, 200 unless set. A handler may return a Response for any other. */
  status?: number;
  run: (call: Call<z.output<S>>) => Promise<O>;
};

const NONE = z.object({});

export function endpoint<O, S extends z.ZodType = typeof NONE>(
  operation: string,
  method: Method,
  path: string | RegExp,
  definition: Definition<S, O>,
): BuildRoute {
  const handle = async (request: Request, ctx: BuildContext) => {
    const caller = await authorize(request, ctx, definition.auth ?? {});
    const input = await parseInput((definition.input ?? NONE) as S, request, groups(path, request));
    const client = await managerClient(request, ctx);
    const output = await definition.run({ ...caller, input, client, request, ctx });
    if (output instanceof Response) return output;
    return Response.json(output, { status: definition.status ?? 200, headers: { "Cache-Control": "no-store" } });
  };
  return { operation, method, path, handle };
}

function groups(path: string | RegExp, request: Request): Record<string, string> {
  if (typeof path === "string") return {};
  const found = path.exec(new URL(request.url).pathname)?.groups ?? {};
  return Object.fromEntries(Object.entries(found).map(([name, value]) => [name, decodeURIComponent(value)]));
}

/** A 404 for something the caller does not own (or that does not exist). */
export function notFound(message: string): EdgeError {
  return new EdgeError(404, message);
}
