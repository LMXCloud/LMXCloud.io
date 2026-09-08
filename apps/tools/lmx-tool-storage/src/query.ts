function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function valuesEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a === "number" && typeof b === "number" && Number.isNaN(a) && Number.isNaN(b)) {
    return true;
  }
  return false;
}

/** Equality or containment: scalar match, array contains scalar, object/array @>-style. */
export function valueMatches(actual: unknown, expected: unknown): boolean {
  if (valuesEqual(actual, expected)) return true;

  if (Array.isArray(actual) && !Array.isArray(expected)) {
    return actual.some((item) => valueMatches(item, expected));
  }

  if (Array.isArray(actual) && Array.isArray(expected)) {
    return expected.every((exp) => actual.some((item) => valueMatches(item, exp)));
  }

  if (isPlainObject(actual) && isPlainObject(expected)) {
    return Object.entries(expected).every(([key, value]) => valueMatches(actual[key], value));
  }

  return false;
}

export function matchesFilter(
  frontmatter: Record<string, unknown>,
  filter: Record<string, unknown>,
): boolean {
  return Object.entries(filter).every(([field, expected]) =>
    valueMatches(frontmatter[field], expected),
  );
}
