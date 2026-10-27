/**
 * The building blocks of the manager's response schemas. The manager speaks
 * snake_case and is loose about absent fields, so a `wire()` object reads each
 * camelCase key from its snake_case spelling first (then the camelCase one,
 * then any aliases), and the leaves coerce instead of rejecting: a missing
 * count reads 0, a missing label null. Each leaf's output type is the type the
 * Build UI works with.
 */
import { z } from "zod";

import { DeployError } from "../errors";

type Raw = Record<string, unknown>;

export function isRecord(value: unknown): value is Raw {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** `chats24h` may arrive as `chats_24h`, `p95Ms` as `p95_ms`. */
function spellings(key: string): string[] {
  const snake = key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
  return [snake.replace(/([a-z])(\d)/g, "$1_$2"), snake, key];
}

/** A wire object whose keys are read by their snake_case spelling; unknown keys are dropped. An
 *  alias may name a nested field (`ci.status`). */
export function wire<S extends z.ZodRawShape>(shape: S, aliases: { [K in keyof S]?: string[] } = {}) {
  return z.preprocess((raw) => {
    const row = isRecord(raw) ? raw : {};
    return Object.fromEntries(
      Object.keys(shape).map((key) => {
        const names = [...spellings(key), ...(aliases[key] ?? [])];
        return [key, names.map((name) => field(row, name)).find((value) => value != null)];
      }),
    );
  }, z.object(shape));
}

function field(row: Raw, name: string): unknown {
  return name.split(".").reduce<unknown>((value, part) => (isRecord(value) ? value[part] : undefined), row);
}

const leaf = <T>(read: (value: unknown) => T) => z.unknown().transform(read);

/** A string; absent reads `fallback`. */
export const text = (fallback = "") => leaf((value) => (value == null ? fallback : String(value)));

/** A string, or null. */
export const maybeText = leaf((value) => (value == null ? null : String(value)));

/** A number; absent reads `fallback` (NaN when there is none). */
export const num = (fallback?: number) => leaf((value) => Number(value ?? fallback));

/** A number, or null. */
export const maybeNum = leaf((value) => (value == null ? null : Number(value)));

/** A positive integer, or null. */
export const positive = leaf((value) => (typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null));

export const flag = leaf((value) => Boolean(value));

/** A flag the manager may not have checked yet: absent reads undefined, "unknown". */
export const probe = leaf((value) => (value == null ? undefined : Boolean(value)));

/** True only when the manager says exactly `true`. */
export const confirmed = leaf((value) => value === true);

/** One of `values`, else `fallback`. */
export const oneOf = <const V extends string, F extends string | null>(values: readonly V[], fallback: F) =>
  leaf((value): V | F => (values.includes(value as V) ? (value as V) : fallback));

/** Unix seconds from seconds, milliseconds, a numeric string or an ISO date; 0 when unreadable. */
export function timestampSeconds(value: unknown): number {
  const numeric = typeof value === "string" && value.trim() ? Number(value.trim()) : value;
  if (typeof numeric === "number" && Number.isFinite(numeric)) {
    return numeric > 100_000_000_000 ? Math.floor(numeric / 1000) : numeric;
  }
  if (typeof value !== "string") return 0;
  const parsed = Date.parse(value.trim());
  return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : 0;
}

export const seconds = leaf(timestampSeconds);

/** A value the edge passes through untouched, or null. */
export const opaque = <T>() => leaf((value) => (value ?? null) as T | null);

/** A list; anything else reads empty. */
export const list = <S extends z.ZodType>(item: S) => z.preprocess((value) => (Array.isArray(value) ? value : []), z.array(item));

/** A list, or null when the wire sends none. */
export const maybeList = <S extends z.ZodType>(item: S) =>
  z.preprocess((value) => (Array.isArray(value) ? value : null), z.array(item).nullable());

/** The strings of a list, others dropped. */
export const strings = leaf((value) =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string" && entry !== "") : [],
);

/** An object keyed by the manager's own names (apps, files), which are never renamed. */
export const dict = <S extends z.ZodType>(item: S) => z.preprocess((value) => (isRecord(value) ? value : {}), z.record(z.string(), item));

/** An object, or null when the wire sends none. */
export const maybe = <S extends z.ZodType>(schema: S) =>
  z.preprocess((value) => (isRecord(value) ? value : null), schema.nullable());

/** A schema the manager must satisfy: a mismatch is the manager's fault, reported as `message`. */
export const strict = <S extends z.ZodType>(schema: S, message: string) =>
  z.unknown().transform((value): z.output<S> => {
    const parsed = schema.safeParse(value);
    if (!parsed.success) throw new DeployError("BACKEND", message);
    return parsed.data;
  });
