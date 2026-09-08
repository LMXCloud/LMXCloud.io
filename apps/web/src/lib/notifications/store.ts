import type {
  NotificationEvent,
  NotificationIdentity,
  NotificationItem,
} from "./types";

const STORAGE_PREFIX = "lmxcloud_console_notification_state";

export interface NotificationReadRecord {
  fingerprint: string;
  readAt: string;
}

export interface NotificationSeenRecord {
  fingerprint: string;
  firstSeenAt: string;
}

export interface NotificationStoreV1 {
  version: 1;
  reads: Record<string, NotificationReadRecord>;
  seen: Record<string, NotificationSeenRecord>;
}

function emptyStore(): NotificationStoreV1 {
  return { version: 1, reads: {}, seen: {} };
}

export function notificationUserId(identity: NotificationIdentity): string {
  const email = identity.email?.trim().toLowerCase();
  const wallet = identity.wallet?.trim().toLowerCase();
  if (identity.authMode === "wallet" && wallet) return `wallet:${wallet}`;
  if (email) return `email:${email}`;
  if (wallet) return `wallet:${wallet}`;
  return "anonymous";
}

export function notificationStorageKey(userId: string): string {
  return `${STORAGE_PREFIX}:${userId}`;
}

export function loadNotificationStore(userId: string): NotificationStoreV1 {
  try {
    const raw = localStorage.getItem(notificationStorageKey(userId));
    if (!raw) return emptyStore();
    const parsed = JSON.parse(raw) as Partial<NotificationStoreV1>;
    if (parsed.version !== 1 || typeof parsed.reads !== "object" || typeof parsed.seen !== "object") {
      return emptyStore();
    }
    return {
      version: 1,
      reads: parsed.reads ?? {},
      seen: parsed.seen ?? {},
    };
  } catch {
    return emptyStore();
  }
}

export function saveNotificationStore(userId: string, store: NotificationStoreV1): void {
  try {
    localStorage.setItem(notificationStorageKey(userId), JSON.stringify(store));
  } catch {
    /* optional */
  }
}

export function hydrateNotificationItems(
  events: NotificationEvent[],
  store: NotificationStoreV1,
): { items: NotificationItem[]; store: NotificationStoreV1 } {
  const next: NotificationStoreV1 = {
    version: 1,
    reads: {},
    seen: {},
  };

  const items: NotificationItem[] = events.map((event) => {
    const seen = store.seen[event.id];
    const firstSeenAt =
      seen && seen.fingerprint === event.fingerprint ? seen.firstSeenAt : event.observedAt;
    next.seen[event.id] = { fingerprint: event.fingerprint, firstSeenAt };

    const read = store.reads[event.id];
    const stillRead = Boolean(read && read.fingerprint === event.fingerprint);
    if (stillRead && read) next.reads[event.id] = read;

    return {
      ...event,
      observedAt: firstSeenAt,
      unread: !stillRead,
      readAt: stillRead && read ? read.readAt : null,
    };
  });

  items.sort(compareNotificationItems);
  return { items, store: next };
}

/** Re-apply any reads that landed while a collect was in flight. */
export function mergeNotificationReads(
  store: NotificationStoreV1,
  incoming: NotificationStoreV1,
  items: NotificationItem[],
): { items: NotificationItem[]; store: NotificationStoreV1 } {
  const fingerprints = new Map(items.map((item) => [item.id, item.fingerprint]));
  const reads = { ...store.reads };

  for (const [id, record] of Object.entries(incoming.reads)) {
    if (fingerprints.get(id) === record.fingerprint) {
      reads[id] = record;
    }
  }

  const nextStore = { ...store, reads };
  const nextItems = items
    .map((item) => {
      const read = reads[item.id];
      const stillRead = Boolean(read && read.fingerprint === item.fingerprint);
      return {
        ...item,
        unread: !stillRead,
        readAt: stillRead && read ? read.readAt : null,
      };
    })
    .sort(compareNotificationItems);

  return { items: nextItems, store: nextStore };
}

export function markNotificationsRead(
  store: NotificationStoreV1,
  items: NotificationItem[],
  ids: string[],
  readAt: string,
): NotificationStoreV1 {
  const idSet = new Set(ids);
  const reads = { ...store.reads };
  for (const item of items) {
    if (!idSet.has(item.id)) continue;
    reads[item.id] = { fingerprint: item.fingerprint, readAt };
  }
  return { ...store, reads };
}

function compareNotificationItems(a: NotificationItem, b: NotificationItem): number {
  const severityRank: Record<NotificationItem["severity"], number> = {
    error: 0,
    warning: 1,
    info: 2,
  };
  const severity = severityRank[a.severity] - severityRank[b.severity];
  if (severity !== 0) return severity;
  if (a.unread !== b.unread) return a.unread ? -1 : 1;
  return b.observedAt.localeCompare(a.observedAt);
}
