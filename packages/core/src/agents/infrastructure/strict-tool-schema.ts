export function toStrictToolSchema(schema: Record<string, unknown>): Record<string, unknown> {
  return transformSchemaForStrictMode(schema);
}

function transformSchemaForStrictMode(schema: Record<string, unknown>): Record<string, unknown> {
  if (schema.type === "object") {
    const propertyEntries = Object.entries(asSchemaMap(schema.properties));
    const required = new Set(asStringArray(schema.required));
    const properties = Object.fromEntries(
      propertyEntries.map(([key, value]) => ([
        key,
        required.has(key)
          ? transformSchemaForStrictMode(value)
          : makeSchemaNullable(transformSchemaForStrictMode(value)),
      ])),
    );
    return {
      ...schema,
      properties,
      required: propertyEntries.map(([key]) => key),
      additionalProperties: false,
    };
  }

  if (schema.type === "array") {
    return {
      ...schema,
      ...(isSchemaRecord(schema.items)
        ? { items: transformSchemaForStrictMode(schema.items) }
        : {}),
    };
  }

  return { ...schema };
}

function makeSchemaNullable(schema: Record<string, unknown>): Record<string, unknown> {
  if (typeof schema.type === "string") {
    return {
      ...schema,
      type: [schema.type, "null"],
    };
  }
  if (Array.isArray(schema.type)) {
    return {
      ...schema,
      type: schema.type.includes("null") ? schema.type : [...schema.type, "null"],
    };
  }
  if (Array.isArray(schema.enum)) {
    return {
      ...schema,
      type: [inferEnumType(schema.enum), "null"],
      enum: schema.enum.includes(null) ? schema.enum : [...schema.enum, null],
    };
  }
  return {
    anyOf: [
      schema,
      { type: "null" },
    ],
  };
}

function inferEnumType(values: readonly unknown[]): string {
  if (values.every((value) => typeof value === "string")) return "string";
  if (values.every((value) => typeof value === "number")) return "number";
  if (values.every((value) => typeof value === "boolean")) return "boolean";
  return "string";
}

function asSchemaMap(value: unknown): Record<string, Record<string, unknown>> {
  if (!isSchemaRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, Record<string, unknown>] => isSchemaRecord(entry[1]),
    ),
  );
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function isSchemaRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
