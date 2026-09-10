import {
  compareNotificationItems,
  deriveKeyExpiringNotifications,
  deriveLowBalanceNotifications,
  deriveProviderHealthNotifications,
  type NotificationEvent,
  type NotificationItem,
  type NotificationKeySnapshot,
  type StatusHealthSnapshot,
} from "@lmxcloud/shared";
import type { ApiKeyRecord, ApiKeyStore } from "../auth/store.js";
import type { CreditStore } from "../credits/store.js";
import { providerUpForStatus, type HealthStore } from "../health/store.js";
import type { ProviderAdapter } from "../providers/types.js";
import type { RoutingSignalStore } from "../routing/signal-store.js";
import { notificationAccountId, notificationAccountIds } from "./account-id.js";
import {
  listNotificationsForUser,
  listReadsForUser,
  markNotificationsRead,
  dismissNotifications,
  upsertSeen,
  type NotificationReadRow,
  type NotificationRow,
} from "./store.js";

export interface NotificationFeedDeps {
  apiKeyStore: ApiKeyStore;
  creditStore: CreditStore;
  healthStore: HealthStore;
  providers: ProviderAdapter[];
  routingSignalStore?: RoutingSignalStore;
}

function authoredToEvent(row: NotificationRow): NotificationEvent {
  return {
    id: row.id,
    kind: row.kind,
    severity: "info",
    title: row.title,
    body: row.body,
    href: row.href ?? undefined,
    hrefLabel: row.hrefLabel ?? undefined,
    fingerprint: row.id,
    observedAt: row.createdAt,
    visibleAt: row.visibleAt,
    expiresAt: row.expiresAt ?? undefined,
  };
}

function applyReads(
  events: NotificationEvent[],
  reads: NotificationReadRow[],
): NotificationItem[] {
  const byId = new Map(reads.map((row) => [row.notificationId, row]));
  const items: NotificationItem[] = [];
  for (const event of events) {
    const read = byId.get(event.id);
    if (read?.dismissedAt && read.fingerprint === event.fingerprint) continue;
    const stillRead = Boolean(
      read?.readAt && read.fingerprint === event.fingerprint,
    );
    items.push({
      ...event,
      observedAt:
        read && read.fingerprint === event.fingerprint
          ? read.seenAt
          : event.observedAt,
      unread: !stillRead,
      readAt: stillRead && read?.readAt ? read.readAt : null,
    });
  }
  return items;
}

export function statusHealthSnapshot(
  deps: Pick<NotificationFeedDeps, "healthStore" | "providers" | "routingSignalStore">,
): StatusHealthSnapshot {
  const statuses = deps.healthStore.getAll();
  const routing = deps.routingSignalStore?.getRoutingSnapshots(
    deps.providers,
    (name) => Boolean(statuses[name]?.healthy),
  );

  return {
    providers: Object.fromEntries(
      deps.providers.map((provider) => {
        const status = statuses[provider.name];
        const route = routing?.byProvider[provider.name];
        return [
          provider.name,
          {
            healthy: providerUpForStatus(status),
            routing: { circuit: route?.circuit ?? "closed" },
          },
        ];
      }),
    ),
  };
}

export async function keySnapshotsForAccount(
  owner: ApiKeyRecord,
  deps: Pick<NotificationFeedDeps, "apiKeyStore" | "creditStore">,
): Promise<{ keys: ApiKeyRecord[]; snapshots: NotificationKeySnapshot[] }> {
  const keys = await deps.apiKeyStore.listForRecord(owner);
  const listed = keys.length > 0 ? keys : [owner];
  const balances = await deps.creditStore.getBalances(listed.map((key) => key.id));
  return {
    keys: listed,
    snapshots: listed.map((key) => ({
      id: key.id,
      balance: balances.get(key.id) ?? 0,
      environment: key.environment,
      expires_at: null,
    })),
  };
}

export function liveAccountAlerts(
  deps: NotificationFeedDeps,
  snapshots: NotificationKeySnapshot[],
  now: Date,
): NotificationEvent[] {
  return [
    ...deriveProviderHealthNotifications(statusHealthSnapshot(deps), now),
    ...deriveLowBalanceNotifications(snapshots, now),
    ...deriveKeyExpiringNotifications(snapshots, now),
  ];
}

export async function buildUserNotificationFeed(
  owner: ApiKeyRecord,
  deps: NotificationFeedDeps,
  now = new Date(),
): Promise<NotificationItem[]> {
  const { keys, snapshots } = await keySnapshotsForAccount(owner, deps);
  const userId = notificationAccountId(owner);
  const accountIds = notificationAccountIds(owner, keys);
  const live = liveAccountAlerts(deps, snapshots, now);
  const authored = (await listNotificationsForUser(accountIds, now)).map(authoredToEvent);
  const events = [...authored, ...live];
  let reads: NotificationReadRow[] = [];
  try {
    reads = await upsertSeen({
      userId,
      items: events.map((event) => ({
        id: event.id,
        fingerprint: event.fingerprint,
      })),
    });
  } catch {
    reads = await listReadsForUser(userId).catch(() => []);
  }
  return applyReads(events, reads).sort(compareNotificationItems);
}

export async function markUserNotificationsRead(
  owner: ApiKeyRecord,
  ids: string[],
  deps: NotificationFeedDeps,
): Promise<NotificationItem[]> {
  const feed = await buildUserNotificationFeed(owner, deps);
  const wanted = new Set(ids);
  const items = feed.filter((item) => wanted.has(item.id));
  await markNotificationsRead({
    userId: notificationAccountId(owner),
    items: items.map((item) => ({ id: item.id, fingerprint: item.fingerprint })),
  });
  return buildUserNotificationFeed(owner, deps);
}

export async function dismissUserNotifications(
  owner: ApiKeyRecord,
  ids: string[],
  deps: NotificationFeedDeps,
): Promise<NotificationItem[]> {
  const feed = await buildUserNotificationFeed(owner, deps);
  const wanted = new Set(ids);
  const items = feed.filter((item) => wanted.has(item.id));
  await dismissNotifications({
    userId: notificationAccountId(owner),
    items: items.map((item) => ({ id: item.id, fingerprint: item.fingerprint })),
  });
  return buildUserNotificationFeed(owner, deps);
}
