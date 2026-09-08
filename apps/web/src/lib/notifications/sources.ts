import { fetchKeys, fetchStatus } from "../../api";
import {
  deriveKeyExpiringNotifications,
  deriveLowBalanceNotifications,
  deriveProviderHealthNotifications,
} from "./derive";
import type { NotificationCollectContext, NotificationEvent, NotificationSource } from "./types";

/**
 * Register a source to add event types. The panel, read-state store, and hook
 * stay unchanged — new kinds only need a collector plus optional icon mapping.
 */
const sources: NotificationSource[] = [];

export function registerNotificationSource(source: NotificationSource): void {
  const index = sources.findIndex((entry) => entry.id === source.id);
  if (index >= 0) {
    sources[index] = source;
    return;
  }
  sources.push(source);
}

export function getNotificationSources(): readonly NotificationSource[] {
  return sources;
}

export async function collectNotificationEvents(
  ctx: NotificationCollectContext,
): Promise<NotificationEvent[]> {
  const batches = await Promise.all(
    sources.map(async (source) => {
      try {
        return await source.collect(ctx);
      } catch {
        return [];
      }
    }),
  );
  return batches.flat();
}

registerNotificationSource({
  id: "provider-health",
  async collect(ctx) {
    const status = await fetchStatus().catch(() => null);
    return deriveProviderHealthNotifications(status, ctx.now);
  },
});

registerNotificationSource({
  id: "account-keys",
  async collect(ctx) {
    if (!ctx.apiKey) return [];
    const keys = await fetchKeys(ctx.apiKey);
    return [
      ...deriveLowBalanceNotifications(keys.data, ctx.now),
      ...deriveKeyExpiringNotifications(keys.data, ctx.now),
    ];
  },
});
