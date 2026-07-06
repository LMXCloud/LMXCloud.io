import crypto from "crypto";

const PREFIX = "lmx_sess_";

export interface SessionPayload {
  id: string;
  email: string;
  exp: number;
}

export function isSessionTokenFormat(token: string): boolean {
  return token.startsWith(PREFIX);
}

export function createSessionToken(
  apiKeyId: string,
  email: string,
  secret: string,
  ttlMs: number,
): string {
  const payload: SessionPayload = {
    id: apiKeyId,
    email: email.trim().toLowerCase(),
    exp: Date.now() + ttlMs,
  };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto.createHmac("sha256", secret).update(body).digest("base64url");
  return `${PREFIX}${body}.${sig}`;
}

export function verifySessionToken(
  token: string,
  secret: string,
): SessionPayload | null {
  if (!token.startsWith(PREFIX)) return null;

  const rest = token.slice(PREFIX.length);
  const dot = rest.lastIndexOf(".");
  if (dot === -1) return null;

  const body = rest.slice(0, dot);
  const sig = rest.slice(dot + 1);
  const expected = crypto.createHmac("sha256", secret).update(body).digest("base64url");

  if (sig.length !== expected.length || !crypto.timingSafeEqual(
    Buffer.from(sig),
    Buffer.from(expected),
  )) {
    return null;
  }

  try {
    const payload = JSON.parse(
      Buffer.from(body, "base64url").toString("utf-8"),
    ) as SessionPayload;

    if (!payload.id || !payload.email || payload.exp < Date.now()) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}
