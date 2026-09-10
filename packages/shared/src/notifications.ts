export const NOTIFICATION_KINDS = {
  PROVIDER_HEALTH: "provider_health",
  LOW_BALANCE: "low_balance",
  KEY_EXPIRING: "key_expiring",
  WELCOME: "welcome",
  PRODUCT_UPDATE: "product_update",
  COMPANY_UPDATE: "company_update",
} as const;

export const AUTHORED_NOTIFICATION_KINDS = [
  NOTIFICATION_KINDS.WELCOME,
  NOTIFICATION_KINDS.PRODUCT_UPDATE,
  NOTIFICATION_KINDS.COMPANY_UPDATE,
] as const;

export type AuthoredNotificationKind =
  (typeof AUTHORED_NOTIFICATION_KINDS)[number];

export type KnownNotificationKind =
  (typeof NOTIFICATION_KINDS)[keyof typeof NOTIFICATION_KINDS];

/** Open string so new event types can ship without changing this union. */
export type NotificationKind = KnownNotificationKind | (string & {});

export type NotificationSeverity = "info" | "warning" | "error";

export interface NotificationEvent {
  /** Stable while the condition persists. Used as the read-state key. */
  id: string;
  kind: NotificationKind;
  severity: NotificationSeverity;
  title: string;
  body: string;
  href?: string;
  /** Button text for `href`, e.g. "Docs". Omitted = derived from the path. */
  hrefLabel?: string;
  /**
   * Snapshot of the underlying signal. A previously-read item becomes unread
   * again when this changes (e.g. a different set of providers is down).
   */
  fingerprint: string;
  /** ISO time the condition was first observed, when known. */
  observedAt: string;
  /** When an authored notice should first appear. Omitted for live alerts. */
  visibleAt?: string;
  /** When an authored notice should leave the feed. Omitted = no timeout. */
  expiresAt?: string;
}

export interface NotificationItem extends NotificationEvent {
  unread: boolean;
  readAt: string | null;
}

/** Matches Overview / Credits “low balance” chips. */
export const LOW_BALANCE_USD = 0.01;

export const KEY_EXPIRY_WARNING_DAYS = 7;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface ProviderHealthSnapshot {
  healthy: boolean;
  routing?: { circuit: "closed" | "open" | "half_open" };
}

export interface StatusHealthSnapshot {
  providers: Record<string, ProviderHealthSnapshot>;
}

export interface NotificationKeySnapshot {
  id: string;
  balance: number;
  environment: string;
  expires_at?: string | null;
}

export function deriveProviderHealthNotifications(
  status: StatusHealthSnapshot | null,
  now: Date,
): NotificationEvent[] {
  if (!status) return [];
  const providers = Object.entries(status.providers);
  if (providers.length === 0) return [];

  const unhealthy = providers
    .filter(([, provider]) => isProviderUnhealthy(provider))
    .map(([name]) => name)
    .sort((a, b) => a.localeCompare(b));

  if (unhealthy.length === 0) return [];

  const noneHealthy = unhealthy.length === providers.length;
  const observedAt = now.toISOString();

  return [
    {
      id: `${NOTIFICATION_KINDS.PROVIDER_HEALTH}:cluster`,
      kind: NOTIFICATION_KINDS.PROVIDER_HEALTH,
      severity: noneHealthy ? "error" : "warning",
      title: noneHealthy
        ? "All inference providers are down"
        : unhealthy.length === 1
          ? "1 inference provider is unhealthy"
          : `${unhealthy.length} inference providers are unhealthy`,
      body: noneHealthy
        ? `${formatNameList(unhealthy)} failed the latest health check. Routing may fail until the network recovers.`
        : `${formatNameList(unhealthy)} failed the latest health check.`,
      href: "/status",
      hrefLabel: "Status",
      fingerprint: `${noneHealthy ? "down" : "degraded"}:${unhealthy.join(",")}`,
      observedAt,
    },
  ];
}

export function deriveLowBalanceNotifications(
  keys: NotificationKeySnapshot[],
  now: Date,
): NotificationEvent[] {
  const total = keys.reduce((sum, key) => sum + key.balance, 0);
  if (total >= LOW_BALANCE_USD) return [];

  return [
    {
      id: `${NOTIFICATION_KINDS.LOW_BALANCE}:account`,
      kind: NOTIFICATION_KINDS.LOW_BALANCE,
      severity: "warning",
      title: "Account balance is low",
      body: `Total credits are ${formatUsd(total, 2)}. Add funds to keep requests running.`,
      href: "/console/credits",
      hrefLabel: "Credits",
      fingerprint: "active",
      observedAt: now.toISOString(),
    },
  ];
}

export function deriveKeyExpiringNotifications(
  keys: NotificationKeySnapshot[],
  now: Date,
): NotificationEvent[] {
  const warningMs = KEY_EXPIRY_WARNING_DAYS * MS_PER_DAY;
  const events: NotificationEvent[] = [];

  for (const key of keys) {
    const expiresAt = key.expires_at;
    if (!expiresAt) continue;
    const expiresMs = new Date(expiresAt).getTime();
    if (!Number.isFinite(expiresMs)) continue;
    const remaining = expiresMs - now.getTime();
    if (remaining > warningMs) continue;

    const expired = remaining <= 0;
    const label = `${key.environment} key ${key.id.slice(0, 8)}…`;
    events.push({
      id: `${NOTIFICATION_KINDS.KEY_EXPIRING}:${key.id}`,
      kind: NOTIFICATION_KINDS.KEY_EXPIRING,
      severity: expired ? "error" : "warning",
      title: expired ? "API key has expired" : "API key expiring soon",
      body: expired
        ? `${label} expired. Create a new key to keep calling the API.`
        : `${label} expires ${formatExpiry(expiresAt)}. Rotate it before requests start failing.`,
      href: "/console/keys",
      hrefLabel: "API keys",
      fingerprint: expiresAt,
      observedAt: now.toISOString(),
    });
  }

  return events;
}

export function compareNotificationItems(
  a: Pick<NotificationItem, "severity" | "unread" | "observedAt">,
  b: Pick<NotificationItem, "severity" | "unread" | "observedAt">,
): number {
  const severityRank: Record<NotificationSeverity, number> = {
    error: 0,
    warning: 1,
    info: 2,
  };
  const severity = severityRank[a.severity] - severityRank[b.severity];
  if (severity !== 0) return severity;
  if (a.unread !== b.unread) return a.unread ? -1 : 1;
  return b.observedAt.localeCompare(a.observedAt);
}

/** Label shown on the expanded notification link. */
export function notificationHrefLabel(
  href: string | null | undefined,
  hrefLabel?: string | null,
): string | null {
  if (!href?.trim()) return null;
  const custom = hrefLabel?.trim();
  if (custom) return custom;

  const value = href.trim();
  if (value.startsWith("/")) {
    const path = (value.split(/[?#]/)[0] ?? value).replace(/\/+$/, "") || "/";
    if (path === "/docs" || path.startsWith("/docs/")) return "Docs";
    if (path === "/status") return "Status";
    if (path.startsWith("/console/credits")) return "Credits";
    if (path.startsWith("/console/keys")) return "API keys";
    if (path.startsWith("/console/overview")) return "Console";
    if (path.startsWith("/console/playground")) return "Playground";
    const last = path.split("/").filter(Boolean).pop();
    if (!last) return "Open";
    return last.replace(/[-_]/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
  }

  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return "Open";
  }
}

function isProviderUnhealthy(provider: ProviderHealthSnapshot): boolean {
  return !provider.healthy || provider.routing?.circuit === "open";
}

function formatUsd(amount: number, digits = 2): string {
  return `$${amount.toFixed(digits)}`;
}

function formatNameList(names: string[], limit = 3): string {
  if (names.length === 0) return "";
  if (names.length === 1) return names[0] ?? "";
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  if (names.length <= limit) {
    return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
  }
  const shown = names.slice(0, limit);
  return `${shown.join(", ")}, and ${names.length - limit} more`;
}

function formatExpiry(iso: string): string {
  return new Date(iso).toLocaleDateString([], {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
