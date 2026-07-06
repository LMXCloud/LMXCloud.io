const STORAGE_KEY = "lmxcloud_dashboard_api_key";
const EMAIL_KEY = "lmxcloud_dashboard_email";

export function readApiKey(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function writeApiKey(value: string | null): void {
  try {
    if (value) localStorage.setItem(STORAGE_KEY, value);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* optional */
  }
}

export function readEmail(): string {
  try {
    return localStorage.getItem(EMAIL_KEY) ?? "";
  } catch {
    return "";
  }
}

export function writeEmail(value: string): void {
  try {
    if (value.trim()) localStorage.setItem(EMAIL_KEY, value.trim());
    else localStorage.removeItem(EMAIL_KEY);
  } catch {
    /* optional */
  }
}
