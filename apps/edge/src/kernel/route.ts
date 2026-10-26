/**
 * A route's input, validated once. The query, the JSON body and the path's
 * named groups are one object (body over query, path over both), parsed by a
 * zod schema; the first issue becomes a 400. A schema's own refinement
 * message is the body's `error`; anything else reads "missing or invalid
 * `field`".
 */
import { z } from "zod";

import { EdgeError } from "./errors";

const BODYLESS = new Set(["GET", "HEAD"]);

export async function parseInput<S extends z.ZodType>(
  schema: S,
  request: Request,
  path: Record<string, string> = {},
): Promise<z.output<S>> {
  const query = Object.fromEntries(new URL(request.url).searchParams);
  const body: unknown = BODYLESS.has(request.method) ? {} : await request.json().catch(() => ({}));
  const parsed = schema.safeParse({ ...query, ...(isRecord(body) ? body : {}), ...path });
  if (parsed.success) return parsed.data;
  const [issue] = parsed.error.issues;
  throw new EdgeError(400, issue.code === "custom" ? issue.message : `missing or invalid \`${String(issue.path[0] ?? "body")}\``);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A number schema that also takes the number's query-string spelling. */
export const numeric = <S extends z.ZodType<number>>(schema: S) =>
  z.preprocess((value) => (typeof value === "string" && value.trim() ? Number(value) : value), schema);

/** A positive id. */
export const id = numeric(z.number().int().positive());

/** A trimmed, non-empty string. */
export const text = z.string().trim().min(1);

/** A list of trimmed strings with the blanks dropped. */
export const names = z.array(z.string()).transform((values) => values.map((value) => value.trim()).filter(Boolean));

/** An opaque pagination cursor: the JSON a previous page returned, or a plain string. */
export const cursor = z.string().transform((value): unknown => {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
});
