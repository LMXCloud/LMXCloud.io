import { formatUsd } from "../format";
import type { ApiKeyInfo } from "../../types";
import { NOTIFICATION_KINDS, type NotificationEvent } from "./types";

/** Matches Overview / Credits “low balance” chips. */
export const LOW_BALANCE_USD = 0.01;

export const KEY_EXPIRY_WARNING_DAYS = 7;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

interface ProviderHealthSnapshot {
  healthy: boolean;
  routing?: { circuit: "closed" | "open" | "half_open" };
}

interface StatusHealthSnapshot {
  providers: Record<string, ProviderHealthSnapshot>;
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
      fingerprint: `${noneHealthy ? "down" : "degraded"}:${unhealthy.join(",")}`,
      observedAt,
    },
  ];
}

export function deriveLowBalanceNotifications(
  keys: ApiKeyInfo[],
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
      fingerprint: "active",
      observedAt: now.toISOString(),
    },
  ];
}

export function deriveKeyExpiringNotifications(
  keys: ApiKeyInfo[],
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
      fingerprint: expiresAt,
      observedAt: now.toISOString(),
    });
  }

  return events;
}

function isProviderUnhealthy(provider: ProviderHealthSnapshot): boolean {
  return !provider.healthy || provider.routing?.circuit === "open";
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
