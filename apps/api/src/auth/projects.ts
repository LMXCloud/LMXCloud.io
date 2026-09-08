export const DEFAULT_PROJECT_NAME = "Default";
export const MAX_PROJECT_NAME_LENGTH = 80;

export function normalizeProjectName(
  value: unknown,
): { ok: true; value: string } | { ok: false; error: string } {
  if (typeof value !== "string") {
    return { ok: false, error: "Field 'name' must be a non-empty string" };
  }

  const name = value.trim().replace(/\s+/g, " ");
  if (name.length === 0) {
    return { ok: false, error: "Field 'name' must be a non-empty string" };
  }
  if (name.length > MAX_PROJECT_NAME_LENGTH) {
    return {
      ok: false,
      error: `Field 'name' must be at most ${MAX_PROJECT_NAME_LENGTH} characters`,
    };
  }

  return { ok: true, value: name };
}

export function parseOptionalProjectId(
  value: unknown,
): { ok: true; value?: string } | { ok: false; error: string } {
  if (value === undefined || value === null || value === "") {
    return { ok: true };
  }
  if (typeof value !== "string" || value.trim() === "") {
    return { ok: false, error: "Field 'project_id' must be a non-empty string" };
  }
  return { ok: true, value: value.trim() };
}

/** Optional display name for an API key (the console "agent" label). */
export function parseOptionalKeyName(
  value: unknown,
): { ok: true; value?: string } | { ok: false; error: string } {
  if (value === undefined || value === null) {
    return { ok: true };
  }
  if (typeof value !== "string") {
    return { ok: false, error: "Field 'name' must be a string" };
  }
  if (value.trim() === "") {
    return { ok: true };
  }
  return normalizeProjectName(value);
}
