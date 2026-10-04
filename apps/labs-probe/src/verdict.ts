import type { JsonSchema } from "./schema.js";

/** One outcome for a paid attempt. input_fault is ours and never a seller miss. */
export type ProbeOutcome =
  | "pass"
  | "no_delivery"
  | "error_body"
  | "empty_result"
  | "shape_mismatch"
  | "assertion_failed"
  | "charged_for_client_error"
  | "server_error_after_payment"
  | "timeout_after_payment"
  | "overcharged"
  | "input_fault"
  | "declined_without_charge";

const SELLER_OUTCOMES = new Set<ProbeOutcome>([
  "no_delivery",
  "error_body",
  "empty_result",
  "shape_mismatch",
  "assertion_failed",
  "charged_for_client_error",
  "server_error_after_payment",
  "timeout_after_payment",
  "overcharged",
]);

export function countsAgainstSeller(outcome: ProbeOutcome | null): boolean {
  return outcome !== null && SELLER_OUTCOMES.has(outcome);
}

export const ASSERTION_OPS = [
  "eq",
  "contains",
  "matches",
  "gt",
  "lt",
  "nonEmpty",
  "isAddress",
  "freshWithinSeconds",
] as const;

export type AssertionOp = (typeof ASSERTION_OPS)[number];

export interface Assertion {
  path: string;
  op: AssertionOp;
  value?: unknown;
}

export interface AssertionResult {
  path: string;
  op: string;
  value?: unknown;
  pass: boolean;
  actual: unknown;
  /** input: the miss is ours, for example a head RPC we could not read. */
  fault: "seller" | "input";
}

export interface ShapeIssue {
  path: string;
  kind: "missing" | "type";
  expected: string;
  actual: string;
}

/** A shape note that must not fail the call. Strict-only and example-only absences land here. */
export interface ShapeWarning {
  path: string;
  reason: string;
}

export type InputEdge = "empty" | "unicode" | "long";

export interface RotationCase {
  body?: unknown;
  query?: Record<string, string>;
  assertions: Assertion[];
  /** Documented input that is not the golden case. */
  edge?: InputEdge;
  /** Safe and risk token checks must point opposite ways. */
  direction?: "safe" | "risk";
  /** A miss is the right answer. A 500 or a fabricated value is not. */
  expect?: "not-found";
}

const OPS = new Set<string>(ASSERTION_OPS);
const VALUE_OPS = new Set<AssertionOp>(["eq", "contains", "matches", "gt", "lt", "freshWithinSeconds"]);

export function parseAssertionList(value: unknown, label: string): Assertion[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error(`${label}[${index}] must be an object`);
    }
    const record = item as Record<string, unknown>;
    if (typeof record.path !== "string" || record.path.trim() === "") {
      throw new Error(`${label}[${index}].path is required`);
    }
    if (typeof record.op !== "string" || !OPS.has(record.op)) {
      throw new Error(`${label}[${index}].op is not a known assertion`);
    }
    const op = record.op as AssertionOp;
    if (VALUE_OPS.has(op) && !("value" in record)) {
      throw new Error(`${label}[${index}].value is required for ${op}`);
    }
    const assertion: Assertion = { path: record.path, op };
    if ("value" in record) assertion.value = record.value;
    return assertion;
  });
}

function scheduleSlot(now: Date, perDay: number): number {
  const minutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  const width = 1440 / perDay;
  return Math.min(perDay - 1, Math.floor(minutes / width));
}

/**
 * Case 0 is the golden input and is what an ordinary run sends.
 * A multi-slot schedule rotates through the pool, including edge cases.
 */
export function selectRotation<T>(cases: readonly T[], now: Date, perDay = 1): { index: number; item: T } {
  if (cases.length === 0) throw new Error("rotation has no cases");
  const index = perDay <= 1
    ? 0
    : (Math.floor(now.getTime() / 86_400_000) * perDay + scheduleSlot(now, perDay)) % cases.length;
  const item = cases[index];
  if (item === undefined) throw new Error("rotation index missed");
  return { index, item };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function jsonType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

/**
 * Structural schema from an output example.
 * Every key is required. Arrays use the first item as the item schema.
 * JSON numbers are type number, since JSON has no integer.
 */
export function schemaFromExample(example: unknown): JsonSchema {
  if (example === null) return { type: "null" };
  if (Array.isArray(example)) {
    const schema: JsonSchema = { type: "array" };
    if (example.length > 0) schema.items = schemaFromExample(example[0]);
    return schema;
  }
  if (typeof example === "object") {
    const properties: Record<string, JsonSchema> = {};
    for (const [key, value] of Object.entries(example)) {
      properties[key] = schemaFromExample(value);
    }
    return {
      type: "object",
      properties,
      required: Object.keys(properties),
    };
  }
  if (typeof example === "number") return { type: "number" };
  return { type: typeof example };
}

/** Listing schema with every declared property treated as required, recursively. */
export function strictListingSchema(schema: JsonSchema): JsonSchema {
  const next: JsonSchema = { ...schema };
  if (schema.properties) {
    const keys = Object.keys(schema.properties);
    next.required = [...new Set([...(schema.required ?? []), ...keys])];
    next.properties = Object.fromEntries(
      Object.entries(schema.properties).map(([key, property]) => [key, strictListingSchema(property)]),
    );
  }
  if (schema.items) next.items = strictListingSchema(schema.items);
  return next;
}

function expectedType(schema: JsonSchema): string {
  if (schema.type === undefined) {
    if (schema.properties || schema.required) return "object";
    if (schema.items || schema.minItems !== undefined || schema.maxItems !== undefined) return "array";
    return "any";
  }
  return Array.isArray(schema.type) ? schema.type.join("|") : schema.type;
}

function typeOk(value: unknown, schema: JsonSchema): boolean {
  // A null value is compatible with every expected type.
  if (value === null) return true;
  // An example value of null is stored as type "null". That does not constrain the live value.
  if (schema.type === "null") return true;
  if (schema.type === undefined) {
    if (schema.properties || schema.required) return isRecord(value);
    if (schema.items || schema.minItems !== undefined || schema.maxItems !== undefined) return Array.isArray(value);
    return true;
  }
  const types = Array.isArray(schema.type) ? schema.type : [schema.type];
  return types.some((type) => {
    if (type === "integer") return typeof value === "number" && Number.isInteger(value);
    if (type === "number") return typeof value === "number" && Number.isFinite(value);
    return jsonType(value) === type;
  });
}

/**
 * Split a body into a real shape failure and warnings.
 * shape_mismatch is only a lenient listing-schema failure, an operator expected-schema
 * failure, or a present key whose JSON type differs. A strict-only absence and an
 * outputExample key that is simply missing are warnings.
 */
export function shapeVerdict(args: {
  parsed: unknown | undefined;
  unparsed: boolean;
  listingSchema?: JsonSchema;
  exampleSchema?: JsonSchema;
  /** formatMatched failed the operator expectedSchema. */
  expectedFailed: boolean;
  /** formatMatched failed the listing schema for a reason the walker did not name. */
  listingFormatFailed: boolean;
}): {
  shapeLenient: true | false | "na";
  shapeStrict: true | false | "na";
  shapeFailed: boolean;
  issues: ShapeIssue[];
  warnings: ShapeWarning[];
} {
  const issues: ShapeIssue[] = [];
  const warnings: ShapeWarning[] = [];
  let shapeLenient: true | false | "na" = "na";
  let shapeStrict: true | false | "na" = "na";
  let shapeFailed = args.expectedFailed || args.listingFormatFailed;

  if (args.listingSchema && args.parsed !== undefined) {
    const lenientIssues = collectShapeIssues(args.parsed, args.listingSchema);
    const strictIssues = collectShapeIssues(args.parsed, strictListingSchema(args.listingSchema));
    shapeLenient = lenientIssues.length === 0;
    shapeStrict = strictIssues.length === 0;
    if (lenientIssues.length > 0) {
      shapeFailed = true;
      issues.push(...lenientIssues);
    }
    const lenientMissing = new Set(lenientIssues.filter((issue) => issue.kind === "missing").map((issue) => issue.path));
    for (const issue of strictIssues) {
      if (issue.kind === "missing" && !lenientMissing.has(issue.path)) {
        warnings.push({
          path: issue.path,
          reason: "declared property is absent; strict listing check only",
        });
      }
    }
  } else if (args.listingSchema && args.unparsed) {
    shapeLenient = false;
    shapeStrict = false;
    shapeFailed = true;
    issues.push({ path: "$", kind: "type", expected: "json", actual: "unparsed" });
  }

  if (args.exampleSchema && args.parsed !== undefined) {
    for (const issue of collectShapeIssues(args.parsed, args.exampleSchema)) {
      if (issue.kind === "missing") {
        warnings.push({ path: issue.path, reason: "outputExample key is absent" });
      } else {
        shapeFailed = true;
        issues.push(issue);
      }
    }
  } else if (args.exampleSchema && args.unparsed && !args.listingSchema) {
    shapeFailed = true;
    issues.push({ path: "$", kind: "type", expected: "json", actual: "unparsed" });
  }

  if (shapeFailed && issues.length === 0) {
    issues.push({ path: "$", kind: "type", expected: "schema", actual: "mismatch" });
  }

  return { shapeLenient, shapeStrict, shapeFailed, issues, warnings };
}

/** Missing keys and type mismatches, by path. Arrays are checked item by item. */
export function collectShapeIssues(value: unknown, schema: JsonSchema, path = "$"): ShapeIssue[] {
  const issues: ShapeIssue[] = [];
  if (!typeOk(value, schema)) {
    issues.push({ path, kind: "type", expected: expectedType(schema), actual: jsonType(value) });
    return issues;
  }

  if (isRecord(value)) {
    for (const key of schema.required ?? []) {
      if (!(key in value)) {
        issues.push({ path: `${path}.${key}`, kind: "missing", expected: "present", actual: "missing" });
      }
    }
    if (schema.properties) {
      for (const [key, property] of Object.entries(schema.properties)) {
        if (key in value) issues.push(...collectShapeIssues(value[key], property, `${path}.${key}`));
      }
    }
  }

  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      issues.push({
        path,
        kind: "type",
        expected: `minItems ${schema.minItems}`,
        actual: `length ${value.length}`,
      });
    }
    if (schema.maxItems !== undefined && value.length > schema.maxItems) {
      issues.push({
        path,
        kind: "type",
        expected: `maxItems ${schema.maxItems}`,
        actual: `length ${value.length}`,
      });
    }
    if (schema.items) {
      value.forEach((item, index) => {
        issues.push(...collectShapeIssues(item, schema.items as JsonSchema, `${path}.${index}`));
      });
    }
  }

  return issues;
}

export function valueAt(root: unknown, path: string): { found: boolean; actual: unknown } {
  if (path === "" || path === "$") return { found: true, actual: root };
  let current: unknown = root;
  for (const part of path.split(".")) {
    if (Array.isArray(current)) {
      const index = Number(part);
      if (!Number.isInteger(index) || String(index) !== part || index < 0 || index >= current.length) {
        return { found: false, actual: null };
      }
      current = current[index];
      continue;
    }
    if (!isRecord(current) || !(part in current)) return { found: false, actual: null };
    current = current[part];
  }
  return { found: true, actual: current };
}

function emptyNode(value: unknown): boolean {
  if (value === null || value === undefined || value === "") return true;
  if (Array.isArray(value)) return value.length === 0;
  if (isRecord(value)) return Object.keys(value).length === 0;
  return false;
}

/** Main payload is empty: [], {}, count/total 0, or a null/empty data, results, or items field. */
export function isEmptyPayload(value: unknown): boolean {
  if (emptyNode(value)) return true;
  if (!isRecord(value)) return false;
  if ("data" in value && emptyNode(value.data)) return true;
  if ("results" in value && Array.isArray(value.results) && value.results.length === 0) return true;
  if ("items" in value && Array.isArray(value.items) && value.items.length === 0) return true;
  if (value.count === 0 || value.total === 0) return true;
  return false;
}

function isHexAddress(value: unknown): value is string {
  return typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value);
}

function parseTimeMs(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value < 1e12 ? value * 1000 : value;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const trimmed = value.trim();
    if (/^-?\d+(\.\d+)?$/.test(trimmed)) return parseTimeMs(Number(trimmed));
    const parsed = Date.parse(trimmed);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function asComparable(value: unknown): bigint | null {
  if (typeof value === "number" && Number.isFinite(value)) return BigInt(Math.trunc(value));
  if (typeof value === "bigint") return value;
  if (typeof value === "string" && /^-?\d+$/.test(value)) return BigInt(value);
  if (typeof value === "string" && /^0x[0-9a-fA-F]+$/.test(value)) return BigInt(value);
  return null;
}

function valuesEqual(actual: unknown, expected: unknown): boolean {
  if (isHexAddress(actual) && isHexAddress(expected)) return actual.toLowerCase() === expected.toLowerCase();
  if (typeof actual === "number" && typeof expected === "number") return actual === expected;
  return JSON.stringify(actual) === JSON.stringify(expected);
}

export function evaluateAssertion(body: unknown, assertion: Assertion, nowMs: number): AssertionResult {
  const looked = valueAt(body, assertion.path);
  const actual = looked.found ? looked.actual : null;
  const base = { path: assertion.path, op: assertion.op, value: assertion.value, actual };

  if (!looked.found) {
    return { ...base, pass: false, fault: "seller" };
  }

  switch (assertion.op) {
    case "eq":
      return { ...base, pass: valuesEqual(actual, assertion.value), fault: "seller" };
    case "contains": {
      const needle = assertion.value;
      const pass = typeof actual === "string" && typeof needle === "string"
        ? actual.includes(needle)
        : Array.isArray(actual) && actual.some((item) => valuesEqual(item, needle));
      return { ...base, pass, fault: "seller" };
    }
    case "matches": {
      if (typeof assertion.value !== "string") return { ...base, pass: false, fault: "input" };
      let pattern: RegExp;
      try {
        pattern = new RegExp(assertion.value);
      } catch {
        return { ...base, pass: false, fault: "input" };
      }
      return { ...base, pass: typeof actual === "string" && pattern.test(actual), fault: "seller" };
    }
    case "gt":
    case "lt": {
      const left = asComparable(actual);
      const right = asComparable(assertion.value);
      if (left === null || right === null) {
        return { ...base, pass: false, fault: right === null ? "input" : "seller" };
      }
      return { ...base, pass: assertion.op === "gt" ? left > right : left < right, fault: "seller" };
    }
    case "nonEmpty":
      return { ...base, pass: !emptyNode(actual) && actual !== null, fault: "seller" };
    case "isAddress":
      return { ...base, pass: isHexAddress(actual), fault: "seller" };
    case "freshWithinSeconds": {
      const seconds = typeof assertion.value === "number" ? assertion.value : null;
      const stamped = parseTimeMs(actual);
      if (seconds === null) return { ...base, pass: false, fault: "input" };
      if (stamped === null) return { ...base, pass: false, fault: "seller" };
      const age = Math.round((nowMs - stamped) / 1000);
      return { ...base, pass: age >= -5 && age <= seconds, actual: age, fault: "seller" };
    }
    default:
      return { ...base, pass: false, fault: "input" };
  }
}

export function evaluateAssertions(body: unknown, assertions: Assertion[], nowMs: number): AssertionResult[] {
  return assertions.map((assertion) => evaluateAssertion(body, assertion, nowMs));
}

/** Compare a paid block number with our own chain head. RPC failure is an input fault. */
export function evaluateBlockHead(args: {
  body: unknown;
  path: string;
  within: number;
  head: bigint | null;
  unavailable: boolean;
}): AssertionResult {
  const looked = valueAt(args.body, args.path);
  const actual = looked.found ? looked.actual : null;
  const base = { path: args.path, op: "withinBlocks", value: args.within, actual };
  if (args.unavailable || args.head === null) {
    return { ...base, pass: false, actual: null, fault: "input" };
  }
  const block = asComparable(actual);
  if (block === null) return { ...base, pass: false, fault: "seller" };
  const delta = block > args.head ? block - args.head : args.head - block;
  const within = BigInt(Math.trunc(args.within));
  return { ...base, pass: delta <= within, actual: Number(delta), fault: "seller" };
}

/** Media type only. A charset parameter does not count as a mismatch. */
export function contentTypeAgrees(
  declared: string | null | undefined,
  actual: string | null | undefined,
): true | false | "na" {
  if (!declared) return "na";
  if (!actual) return false;
  const media = (value: string) => value.split(";")[0]?.trim().toLowerCase() ?? "";
  return media(declared) === media(actual);
}

const TIMESTAMP_KEY = /(timestamp|^time$|^date$|updated_at|updatedat|created_at|createdat|as_of|^asof$|generated_at|generatedat|block_time|blocktime|observed_at|observedat)$/i;

/** Age in seconds of the first timestamp-like field, when one parses. */
export function findTimestampAge(value: unknown, nowMs: number, path = "$"): { path: string; ageSeconds: number } | null {
  if (Array.isArray(value)) {
    if (value.length === 0) return null;
    return findTimestampAge(value[0], nowMs, `${path}.0`);
  }
  if (!isRecord(value)) return null;
  for (const [key, child] of Object.entries(value)) {
    if (!TIMESTAMP_KEY.test(key)) continue;
    const stamped = parseTimeMs(child);
    if (stamped === null) continue;
    return { path: `${path}.${key}`, ageSeconds: Math.round((nowMs - stamped) / 1000) };
  }
  for (const [key, child] of Object.entries(value)) {
    const nested = findTimestampAge(child, nowMs, `${path}.${key}`);
    if (nested) return nested;
  }
  return null;
}

/**
 * A live-data endpoint whose paid body hash has never changed across earlier runs.
 * The first observation is not stale.
 */
export function isStaleCache(args: { liveData: boolean; priorHashes: string[]; current: string | null }): boolean {
  if (!args.liveData || !args.current || args.priorHashes.length === 0) return false;
  return args.priorHashes.every((hash) => hash === args.current);
}

export function isTimeoutError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const name = "name" in error ? String(error.name) : "";
  if (name === "TimeoutError") return true;
  const message = error instanceof Error ? error.message : "";
  return /timeout/i.test(message);
}

export interface OutcomeInput {
  /** The paid request was sent. A pre-payment refusal is not a paid result. */
  paymentSent: boolean;
  didPay: boolean;
  /** Missing or malformed input on our side. Never a seller outcome. */
  inputFault: boolean;
  timeout: boolean;
  httpStatus: number | null;
  errorLikeBody: boolean;
  nonempty: boolean;
  emptyPayload: boolean;
  expectNonEmpty: boolean;
  shapeFailed: boolean;
  assertionFailed: boolean;
  /** Every failed assertion is ours, for example the head RPC. */
  assertionInputFault: boolean;
}

/**
 * Exactly one outcome. Seller failures are ordered so a charged 4xx is not
 * also called a shape miss, and our input fault is never a seller miss.
 */
export function classifyOutcome(args: OutcomeInput): ProbeOutcome | null {
  if (!args.paymentSent) return args.inputFault ? "input_fault" : null;
  if (args.timeout) return "timeout_after_payment";
  if (args.inputFault) return "input_fault";
  if (!args.didPay) return null;
  if (args.httpStatus !== null && args.httpStatus >= 400 && args.httpStatus < 500) return "charged_for_client_error";
  if (args.httpStatus !== null && args.httpStatus >= 500) return "server_error_after_payment";
  if (args.errorLikeBody) return "error_body";
  if (args.expectNonEmpty && args.emptyPayload && args.nonempty) return "empty_result";
  if (args.httpStatus === null || args.httpStatus < 200 || args.httpStatus >= 300 || !args.nonempty) return "no_delivery";
  if (args.shapeFailed) return "shape_mismatch";
  if (args.assertionFailed) return "assertion_failed";
  if (args.assertionInputFault) return "input_fault";
  return "pass";
}
