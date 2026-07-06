const DEMO_KEY = "lmxcloud_landing_demo_key";

export function readDemoApiKey(): string | null {
  try {
    return sessionStorage.getItem(DEMO_KEY);
  } catch {
    return null;
  }
}

export function writeDemoApiKey(value: string): void {
  try {
    sessionStorage.setItem(DEMO_KEY, value);
  } catch {
    /* optional */
  }
}

export function clearDemoApiKey(): void {
  try {
    sessionStorage.removeItem(DEMO_KEY);
  } catch {
    /* optional */
  }
}
