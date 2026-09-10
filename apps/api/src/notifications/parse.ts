import {
  AUTHORED_NOTIFICATION_KINDS,
  type AuthoredNotificationKind,
} from "@lmxcloud/shared";

const KINDS = new Set<string>(AUTHORED_NOTIFICATION_KINDS);

const MAX_TITLE = 200;
const MAX_BODY = 4000;
const MAX_HREF = 500;
const MAX_HREF_LABEL = 40;

export type OpsNotificationInsert = {
  kind: AuthoredNotificationKind;
  title: string;
  body: string;
  href: string | null;
  hrefLabel: string | null;
  target: string | null;
  visibleAt: string | null;
  expiresAt: string | null;
};

export type WelcomeTemplatePatch = {
  title: string;
  body: string;
  href: string | null;
};

function isKind(value: string): value is AuthoredNotificationKind {
  return KINDS.has(value);
}

export function parseHref(
  raw: unknown,
): { ok: true; value: string | null } | { ok: false; message: string } {
  if (raw == null || raw === "") return { ok: true, value: null };
  if (typeof raw !== "string") {
    return { ok: false, message: "href must be a string" };
  }
  const href = raw.trim();
  if (!href) return { ok: true, value: null };
  if (href.length > MAX_HREF) {
    return { ok: false, message: `href must be at most ${MAX_HREF} characters` };
  }
  if (href.startsWith("/")) return { ok: true, value: href };
  try {
    const url = new URL(href);
    if (url.protocol === "http:" || url.protocol === "https:") {
      return { ok: true, value: href };
    }
  } catch {
    /* invalid */
  }
  return {
    ok: false,
    message: "href must be a relative path or http(s) URL",
  };
}

export function parseHrefLabel(
  raw: unknown,
): { ok: true; value: string | null } | { ok: false; message: string } {
  if (raw == null || raw === "") return { ok: true, value: null };
  if (typeof raw !== "string") {
    return { ok: false, message: "hrefLabel must be a string" };
  }
  const label = raw.trim();
  if (!label) return { ok: true, value: null };
  if (label.length > MAX_HREF_LABEL) {
    return { ok: false, message: `hrefLabel must be at most ${MAX_HREF_LABEL} characters` };
  }
  return { ok: true, value: label };
}

function parseTitleBody(rec: Record<string, unknown>):
  | { ok: true; title: string; body: string }
  | { ok: false; message: string } {
  const title = typeof rec.title === "string" ? rec.title.trim() : "";
  if (!title) return { ok: false, message: "title is required" };
  if (title.length > MAX_TITLE) {
    return { ok: false, message: `title must be at most ${MAX_TITLE} characters` };
  }
  const body = typeof rec.body === "string" ? rec.body.trim() : "";
  if (!body) return { ok: false, message: "body is required" };
  if (body.length > MAX_BODY) {
    return { ok: false, message: `body must be at most ${MAX_BODY} characters` };
  }
  return { ok: true, title, body };
}

export function parseOpsNotificationBody(
  body: unknown,
): { ok: true; value: OpsNotificationInsert } | { ok: false; message: string } {
  if (!body || typeof body !== "object") {
    return { ok: false, message: "Expected a JSON object" };
  }
  const rec = body as Record<string, unknown>;
  const kind = typeof rec.kind === "string" ? rec.kind.trim() : "";
  if (!isKind(kind)) {
    return {
      ok: false,
      message: "kind must be welcome, product_update, or company_update",
    };
  }
  const text = parseTitleBody(rec);
  if (!text.ok) return text;
  const href = parseHref(rec.href);
  if (!href.ok) return href;
  const hrefLabel = parseHrefLabel(rec.hrefLabel);
  if (!hrefLabel.ok) return hrefLabel;
  if (hrefLabel.value && !href.value) {
    return { ok: false, message: "hrefLabel requires href" };
  }

  const targetRaw =
    rec.target == null || rec.target === ""
      ? null
      : typeof rec.target === "string"
        ? rec.target.trim()
        : undefined;
  if (targetRaw === undefined) {
    return { ok: false, message: "target must be a string" };
  }

  const visibleAt = parseOptionalIso(rec.visibleAt, "visibleAt");
  if (!visibleAt.ok) return visibleAt;
  const expiresAt = parseOptionalIso(rec.expiresAt, "expiresAt");
  if (!expiresAt.ok) return expiresAt;
  if (visibleAt.value && expiresAt.value) {
    if (new Date(expiresAt.value).getTime() <= new Date(visibleAt.value).getTime()) {
      return { ok: false, message: "expiresAt must be after visibleAt" };
    }
  } else if (expiresAt.value && new Date(expiresAt.value).getTime() <= Date.now()) {
    return { ok: false, message: "expiresAt must be in the future" };
  }

  return {
    ok: true,
    value: {
      kind,
      title: text.title,
      body: text.body,
      href: href.value,
      hrefLabel: hrefLabel.value,
      target: targetRaw,
      visibleAt: visibleAt.value,
      expiresAt: expiresAt.value,
    },
  };
}

function parseOptionalIso(
  raw: unknown,
  field: string,
): { ok: true; value: string | null } | { ok: false; message: string } {
  if (raw == null || raw === "") return { ok: true, value: null };
  if (typeof raw !== "string") {
    return { ok: false, message: `${field} must be an ISO-8601 timestamp` };
  }
  const trimmed = raw.trim();
  if (!trimmed) return { ok: true, value: null };
  const at = new Date(trimmed);
  if (!Number.isFinite(at.getTime())) {
    return { ok: false, message: `${field} must be an ISO-8601 timestamp` };
  }
  return { ok: true, value: at.toISOString() };
}

export function parseWelcomeTemplateBody(
  body: unknown,
): { ok: true; value: WelcomeTemplatePatch } | { ok: false; message: string } {
  if (!body || typeof body !== "object") {
    return { ok: false, message: "Expected a JSON object" };
  }
  const rec = body as Record<string, unknown>;
  const text = parseTitleBody(rec);
  if (!text.ok) return text;
  const href = parseHref(rec.href);
  if (!href.ok) return href;
  return {
    ok: true,
    value: { title: text.title, body: text.body, href: href.value },
  };
}

export function parseReadBody(
  body: unknown,
): { ok: true; ids: string[] } | { ok: false; message: string } {
  if (!body || typeof body !== "object") {
    return { ok: false, message: "Expected a JSON object" };
  }
  const rec = body as Record<string, unknown>;
  const raw = rec.ids;
  if (!Array.isArray(raw) || raw.length === 0) {
    return { ok: false, message: "ids must be a non-empty array of strings" };
  }
  const ids: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string" || !item.trim()) {
      return { ok: false, message: "ids must be a non-empty array of strings" };
    }
    ids.push(item.trim());
  }
  return { ok: true, ids: [...new Set(ids)] };
}
