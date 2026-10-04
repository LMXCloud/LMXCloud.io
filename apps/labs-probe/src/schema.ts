export interface JsonSchema {
  type?: string | string[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: unknown[];
  const?: unknown;
  oneOf?: JsonSchema[];
  anyOf?: JsonSchema[];
  additionalProperties?: boolean | JsonSchema;
  minimum?: number;
  maximum?: number;
  minItems?: number;
  maxItems?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function jsonType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function deepEqual(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (typeof left !== "object" || typeof right !== "object" || left === null || right === null) {
    return false;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    return left.every((item, index) => deepEqual(item, right[index]));
  }
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const keys = Object.keys(leftRecord);
  if (keys.length !== Object.keys(rightRecord).length) return false;
  return keys.every((key) => deepEqual(leftRecord[key], rightRecord[key]));
}

function typeOk(value: unknown, schema: JsonSchema): boolean {
  // A null value is compatible with every expected type.
  if (value === null) return true;
  // An example value of null is stored as type "null". That does not constrain the live value.
  if (schema.type === "null") return true;
  if (schema.type === undefined) {
    if (schema.properties || schema.required) return isRecord(value);
    if (schema.items || schema.minItems !== undefined || schema.maxItems !== undefined) {
      return Array.isArray(value);
    }
    return true;
  }
  const types = Array.isArray(schema.type) ? schema.type : [schema.type];
  return types.some((type) => {
    if (type === "integer") return typeof value === "number" && Number.isInteger(value);
    if (type === "number") return typeof value === "number" && Number.isFinite(value);
    return jsonType(value) === type;
  });
}

/** Subset of JSON Schema used by listings: objects, arrays, enums, oneOf. */
export function matchesSchema(value: unknown, schema: JsonSchema): boolean {
  if (schema.const !== undefined && !deepEqual(value, schema.const)) return false;
  if (schema.enum !== undefined && !schema.enum.some((item) => deepEqual(value, item))) return false;
  if (schema.oneOf !== undefined) {
    const hits = schema.oneOf.filter((item) => matchesSchema(value, item)).length;
    if (hits !== 1) return false;
  }
  if (schema.anyOf !== undefined && !schema.anyOf.some((item) => matchesSchema(value, item))) {
    return false;
  }
  if (!typeOk(value, schema)) return false;

  if (isRecord(value)) {
    for (const key of schema.required ?? []) {
      if (!(key in value)) return false;
    }
    if (schema.properties) {
      for (const [key, property] of Object.entries(schema.properties)) {
        if (key in value && !matchesSchema(value[key], property)) return false;
      }
    }
    if (schema.additionalProperties === false) {
      const known = new Set(Object.keys(schema.properties ?? {}));
      if (Object.keys(value).some((key) => !known.has(key))) return false;
    } else if (isRecord(schema.additionalProperties)) {
      for (const [key, child] of Object.entries(value)) {
        if (schema.properties && key in schema.properties) continue;
        if (!matchesSchema(child, schema.additionalProperties as JsonSchema)) return false;
      }
    }
  }

  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) return false;
    if (schema.maxItems !== undefined && value.length > schema.maxItems) return false;
    if (schema.items) {
      for (const item of value) {
        if (!matchesSchema(item, schema.items)) return false;
      }
    }
  }

  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) return false;
    if (schema.maximum !== undefined && value > schema.maximum) return false;
  }

  return true;
}

/**
 * Response schema advertised on the 402, when the listing actually declares one.
 * v1 puts it on accepts[].outputSchema. v2 Bazaar puts a discovery document at
 * extensions.bazaar.schema; that document's output block describes `{ type, example }`,
 * not the HTTP body, so it is ignored. "na" when nothing usable is declared.
 */
export function listingOutputSchema(paymentRequired: object): JsonSchema | undefined {
  const record = paymentRequired as {
    extensions?: Record<string, unknown>;
    accepts?: Array<{ outputSchema?: unknown }>;
  };
  const fromExtension = schemaOutput(record.extensions?.bazaar);
  if (fromExtension) return fromExtension;
  return schemaOutput(record.accepts?.[0]?.outputSchema);
}

function asSchema(value: unknown): JsonSchema | undefined {
  if (!isRecord(value)) return undefined;
  if (value.type || value.properties || value.required || value.oneOf || value.anyOf || value.enum) {
    return value as JsonSchema;
  }
  return undefined;
}

/** Bazaar's generated output schema describes `{ type, example }`, not the HTTP body. */
function isDiscoveryWrapper(schema: JsonSchema): boolean {
  const keys = Object.keys(schema.properties ?? {});
  return keys.length > 0 && keys.every((key) => key === "type" || key === "example" || key === "format");
}

function usefulResponseSchema(value: unknown): JsonSchema | undefined {
  const schema = asSchema(value);
  if (!schema || isDiscoveryWrapper(schema)) return undefined;
  if (schema.properties || schema.required || schema.oneOf || schema.anyOf || schema.enum) return schema;
  return undefined;
}

/**
 * What the public Bazaar listing says the call returns.
 * The HTTP body schema, when present, is `schema.properties.output.properties.example`.
 * The wrapper `{ type, example }` is not a response schema.
 */
export function discoveryOutput(extensions: unknown): { example?: unknown; schema?: JsonSchema } {
  if (!isRecord(extensions)) return {};
  const bazaar = extensions.bazaar;
  if (!isRecord(bazaar)) return { schema: schemaOutput(extensions) };

  let example: unknown;
  if (isRecord(bazaar.info) && isRecord(bazaar.info.output) && "example" in bazaar.info.output) {
    example = bazaar.info.output.example;
  }

  let schema: JsonSchema | undefined;
  if (isRecord(bazaar.schema) && isRecord(bazaar.schema.properties)) {
    const output = bazaar.schema.properties.output;
    if (isRecord(output) && isRecord(output.properties)) {
      schema = usefulResponseSchema(output.properties.example);
    }
  }
  return { example, schema: schema ?? schemaOutput(bazaar) };
}

export interface DeclaredInput {
  query: string[];
  body: string[];
}

const INPUT_WRAPPER = new Set([
  "type",
  "method",
  "bodyType",
  "body",
  "queryParams",
  "pathParams",
  "headers",
  "discoverable",
]);

/**
 * Names a client must send.
 * A JSON Schema contributes its `required` list. A plain example object contributes its keys.
 * A schema with no `required` list contributes nothing.
 */
function requiredFieldNames(value: unknown): string[] {
  if (!isRecord(value)) return [];
  if (Array.isArray(value.required)) {
    return value.required.filter((item): item is string => typeof item === "string" && item.length > 0);
  }
  if ("type" in value || "properties" in value || "$schema" in value) return [];
  return Object.keys(value);
}

function unique(names: string[]): string[] {
  return [...new Set(names)];
}

function schemaInputProperties(bazaar: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!isRecord(bazaar.schema) || !isRecord(bazaar.schema.properties)) return undefined;
  const input = bazaar.schema.properties.input;
  if (!isRecord(input) || !isRecord(input.properties)) return undefined;
  return input.properties;
}

/** Required query and body fields from a v2 `extensions.bazaar` document. */
function bazaarDeclaredInput(bazaar: unknown): DeclaredInput {
  if (!isRecord(bazaar)) return { query: [], body: [] };
  const properties = schemaInputProperties(bazaar);
  const infoInput = isRecord(bazaar.info) && isRecord(bazaar.info.input) ? bazaar.info.input : undefined;

  const query = properties && "queryParams" in properties
    ? requiredFieldNames(properties.queryParams)
    : requiredFieldNames(infoInput?.queryParams);
  const body = properties && "body" in properties
    ? requiredFieldNames(properties.body)
    : requiredFieldNames(infoInput?.body);
  return { query, body };
}

/**
 * Schema `required` wins. A plain example's keys are inputs only when the parent
 * does not already say which fields are required (including an empty list).
 */
function declarationNames(source: unknown, parent: Record<string, unknown>): string[] {
  if (!isRecord(source)) return [];
  if (Array.isArray(source.required) || "type" in source || "properties" in source || "$schema" in source) {
    return requiredFieldNames(source);
  }
  if (Array.isArray(parent.required)) return [];
  return requiredFieldNames(source);
}

function assignHttpInput(input: Record<string, unknown>, into: DeclaredInput): void {
  const querySource = input.queryParams ?? input.query_params ?? input.query ?? input.params;
  const bodySource = input.body ?? input.bodyFields ?? input.body_fields ?? input.bodyParams ?? input.data;
  if (querySource !== undefined || bodySource !== undefined) {
    into.query.push(...declarationNames(querySource, input));
    into.body.push(...declarationNames(bodySource, input));
    return;
  }
  const names = requiredFieldNames(input).filter((name) => !INPUT_WRAPPER.has(name));
  const method = typeof input.method === "string" ? input.method.toUpperCase() : "";
  const bucket = method === "GET" || method === "HEAD" || method === "DELETE" ? into.query : into.body;
  bucket.push(...names);
}

/** Required query and body fields from v1 `accepts[].outputSchema.input`. */
function v1DeclaredInput(payment: Record<string, unknown>): DeclaredInput {
  const into: DeclaredInput = { query: [], body: [] };
  if (!Array.isArray(payment.accepts)) return into;
  for (const accept of payment.accepts) {
    if (!isRecord(accept) || !isRecord(accept.outputSchema) || !isRecord(accept.outputSchema.input)) continue;
    assignHttpInput(accept.outputSchema.input, into);
  }
  return { query: unique(into.query), body: unique(into.body) };
}

/**
 * Required client inputs declared on a live 402.
 * v2 reads `extensions.bazaar`. v1 reads `accepts[].outputSchema.input`.
 * Discovery wrapper keys such as `type` and `method` are not inputs.
 */
export function declaredRequiredInput(payment: unknown): DeclaredInput {
  if (!isRecord(payment)) return { query: [], body: [] };
  const bazaar = isRecord(payment.extensions) ? bazaarDeclaredInput(payment.extensions.bazaar) : { query: [], body: [] };
  const v1 = v1DeclaredInput(payment);
  return {
    query: unique([...bazaar.query, ...v1.query]),
    body: unique([...bazaar.body, ...v1.body]),
  };
}

function schemaOutput(value: unknown): JsonSchema | undefined {
  if (!isRecord(value)) return undefined;
  const schema = isRecord(value.schema) ? value.schema : value;
  const properties = isRecord(schema.properties) ? schema.properties : undefined;
  if (properties && "output" in properties) {
    const output = asSchema(properties.output);
    if (output && !isDiscoveryWrapper(output)) return output;
    return undefined;
  }
  if (properties && "input" in properties) return undefined;
  return asSchema(schema);
}
