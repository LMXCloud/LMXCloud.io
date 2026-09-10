import { fetchNotifications } from "../../api";
import type {
  NotificationCollectContext,
  NotificationEvent,
  NotificationItem,
  NotificationSource,
} from "./types";

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

function toNotificationEvent(item: NotificationItem): NotificationEvent {
  const href = item.href?.trim();
  const event: NotificationEvent & { unread: boolean; readAt: string | null } = {
    id: item.id,
    kind: item.kind,
    severity: item.severity,
    title: item.title,
    body: item.body,
    fingerprint: item.fingerprint,
    observedAt: item.observedAt,
    unread: item.unread,
    readAt: item.readAt,
  };
  if (href) event.href = href;
  const hrefLabel = item.hrefLabel?.trim();
  if (hrefLabel) event.hrefLabel = hrefLabel;
  if (item.visibleAt) event.visibleAt = item.visibleAt;
  if (item.expiresAt) event.expiresAt = item.expiresAt;
  return event;
}

registerNotificationSource({
  id: "lmx-ops-feed",
  async collect(ctx) {
    if (!ctx.apiKey) return [];
    const items = await fetchNotifications(ctx.apiKey);
    return items.map(toNotificationEvent);
  },
});
