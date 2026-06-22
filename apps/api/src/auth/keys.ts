import crypto from "crypto";

const API_KEY_PATTERN = /^lmx_[0-9a-f]{32}$/;

export function generateApiKey(): string {
  return `lmx_${crypto.randomBytes(16).toString("hex")}`;
}

export function isValidApiKeyFormat(key: string): boolean {
  return API_KEY_PATTERN.test(key);
}

export function hashApiKey(key: string): string {
  return crypto.createHash("sha256").update(key).digest("hex");
}

export function extractBearerToken(header: string | undefined): string | null {
  if (!header?.startsWith("Bearer ")) {
    return null;
  }

  const token = header.slice("Bearer ".length).trim();
  return token.length > 0 ? token : null;
}
