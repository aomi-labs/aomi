import type { PipelineJsonSchema } from "./types";

export class PipelineSchemaError extends TypeError {
  constructor(
    readonly path: string,
    message: string,
  ) {
    super(`${path}: ${message}`);
    this.name = "PipelineSchemaError";
  }
}

/**
 * Small dependency-free validator for the JSON Schema vocabulary emitted by
 * the live Catalog. The backend remains authoritative; this catches ordinary
 * integration mistakes before an operation POST without pretending to be a
 * complete JSON Schema implementation.
 */
export function validatePipelineArguments(
  value: unknown,
  schema: PipelineJsonSchema,
): void {
  validate(value, schema, "$arguments");
}

function validate(value: unknown, schema: PipelineJsonSchema, path: string) {
  if (schema === true) return;
  if (schema === false) throw new PipelineSchemaError(path, "is not allowed");

  const variants = schema.oneOf ?? schema.anyOf;
  if (Array.isArray(variants) && variants.length > 0) {
    const accepted = variants.some((variant) => {
      if (!isSchema(variant)) return false;
      try {
        validate(value, variant, path);
        return true;
      } catch (error) {
        if (error instanceof PipelineSchemaError) return false;
        throw error;
      }
    });
    if (!accepted) {
      throw new PipelineSchemaError(path, "does not match an accepted shape");
    }
    return;
  }

  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) {
    throw new PipelineSchemaError(path, "is not an allowed value");
  }

  const type = schema.type;
  if (typeof type === "string" && !matchesType(value, type)) {
    throw new PipelineSchemaError(path, `must be ${article(type)}${type}`);
  }

  if (type === "object" || schema.properties || schema.required) {
    if (!isRecord(value)) {
      throw new PipelineSchemaError(path, "must be an object");
    }
    const required = Array.isArray(schema.required)
      ? schema.required.filter(
          (item): item is string => typeof item === "string",
        )
      : [];
    for (const key of required) {
      if (!(key in value)) {
        throw new PipelineSchemaError(`${path}.${key}`, "is required");
      }
    }
    if (isRecord(schema.properties)) {
      for (const [key, childSchema] of Object.entries(schema.properties)) {
        if (key in value && isSchema(childSchema)) {
          validate(value[key], childSchema, `${path}.${key}`);
        }
      }
    }
  }

  if (type === "array" && Array.isArray(value) && isSchema(schema.items)) {
    value.forEach((item, index) =>
      validate(item, schema.items as PipelineJsonSchema, `${path}[${index}]`),
    );
  }
}

function matchesType(value: unknown, type: string): boolean {
  switch (type) {
    case "null":
      return value === null;
    case "array":
      return Array.isArray(value);
    case "object":
      return isRecord(value);
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "string":
      return typeof value === "string";
    case "boolean":
      return typeof value === "boolean";
    default:
      return true;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isSchema(value: unknown): value is PipelineJsonSchema {
  return typeof value === "boolean" || isRecord(value);
}

function article(value: string): string {
  return /^[aeiou]/i.test(value) ? "an " : "a ";
}
