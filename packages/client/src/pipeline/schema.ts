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
  definitions?: Record<string, PipelineJsonSchema>,
): void {
  validate(value, schema, "$arguments", definitions);
}

function validate(
  value: unknown,
  schema: PipelineJsonSchema,
  path: string,
  definitions?: Record<string, PipelineJsonSchema>,
) {
  if (schema === true) return;
  if (schema === false) throw new PipelineSchemaError(path, "is not allowed");

  if (typeof schema.$ref === "string") {
    const name = schema.$ref.match(/^#\/components\/schemas\/(.+)$/)?.[1];
    const definition = name ? definitions?.[name] : undefined;
    if (!definition)
      throw new PipelineSchemaError(path, "references an unknown schema");
    validate(value, definition, path, definitions);
    return;
  }

  if (Array.isArray(schema.allOf)) {
    for (const member of schema.allOf) {
      if (isSchema(member)) validate(value, member, path, definitions);
    }
  }

  const variants = schema.oneOf ?? schema.anyOf;
  if (Array.isArray(variants) && variants.length > 0) {
    const accepted = variants.some((variant) => {
      if (!isSchema(variant)) return false;
      try {
        validate(value, variant, path, definitions);
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

  if ("const" in schema && schema.const !== value) {
    throw new PipelineSchemaError(path, "does not match the required value");
  }

  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) {
    throw new PipelineSchemaError(path, "is not an allowed value");
  }

  const type = schema.type;
  if (typeof type === "string" && !matchesType(value, type)) {
    throw new PipelineSchemaError(path, `must be ${article(type)}${type}`);
  }
  if (
    Array.isArray(type) &&
    !type.some(
      (candidate) =>
        typeof candidate === "string" && matchesType(value, candidate),
    )
  ) {
    throw new PipelineSchemaError(path, "has an invalid type");
  }
  if (
    typeof schema.minimum === "number" &&
    typeof value === "number" &&
    value < schema.minimum
  ) {
    throw new PipelineSchemaError(path, `must be at least ${schema.minimum}`);
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
      if (schema.additionalProperties === false) {
        for (const key of Object.keys(value)) {
          if (!(key in schema.properties))
            throw new PipelineSchemaError(
              `${path}.${key}`,
              "is not an allowed property",
            );
        }
      }
      for (const [key, childSchema] of Object.entries(schema.properties)) {
        if (key in value && isSchema(childSchema)) {
          validate(value[key], childSchema, `${path}.${key}`, definitions);
        }
      }
    }
  }

  if (type === "array" && Array.isArray(value) && isSchema(schema.items)) {
    if (typeof schema.minItems === "number" && value.length < schema.minItems) {
      throw new PipelineSchemaError(
        path,
        `must contain at least ${schema.minItems} item(s)`,
      );
    }
    value.forEach((item, index) =>
      validate(
        item,
        schema.items as PipelineJsonSchema,
        `${path}[${index}]`,
        definitions,
      ),
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
