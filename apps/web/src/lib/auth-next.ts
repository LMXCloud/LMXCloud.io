const AUTH_NEXT_KEY = "lmxcloud_auth_next";

const ALLOWED_PREFIXES = ["/console/", "/new-agent"];
const ALLOWED_EXACT = new Set(["/new-agent", "/console"]);

export function safeAuthNext(value: string | null | undefined): string | null {
  if (!value) return null;
  const path = value.trim();
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\")) {
    return null;
  }
  if (path.startsWith("/sign-in") || path.startsWith("/sign-up") || path.startsWith("/auth/")) {
    return null;
  }
  const pathname = path.split("?")[0]?.split("#")[0] ?? path;
  if (ALLOWED_EXACT.has(pathname) || ALLOWED_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
    return path;
  }
  return null;
}

export function rememberAuthNext(path: string): void {
  const safe = safeAuthNext(path);
  try {
    if (safe) sessionStorage.setItem(AUTH_NEXT_KEY, safe);
    else sessionStorage.removeItem(AUTH_NEXT_KEY);
  } catch {
    /* optional */
  }
}

export function consumeAuthNext(fallback = "/console/overview"): string {
  let stored: string | null = null;
  try {
    stored = sessionStorage.getItem(AUTH_NEXT_KEY);
    sessionStorage.removeItem(AUTH_NEXT_KEY);
  } catch {
    stored = null;
  }
  return safeAuthNext(stored) ?? fallback;
}

export function peekAuthNext(): string | null {
  try {
    return safeAuthNext(sessionStorage.getItem(AUTH_NEXT_KEY));
  } catch {
    return null;
  }
}
