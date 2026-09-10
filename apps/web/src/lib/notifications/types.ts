import {
  AUTHORED_NOTIFICATION_KINDS,
  type NotificationEvent,
} from "@lmxcloud/shared";

export {
  AUTHORED_NOTIFICATION_KINDS,
  NOTIFICATION_KINDS,
  notificationHrefLabel,
  type AuthoredNotificationKind,
  type KnownNotificationKind,
  type NotificationEvent,
  type NotificationItem,
  type NotificationKind,
  type NotificationSeverity,
} from "@lmxcloud/shared";

export interface NotificationCollectContext {
  apiKey: string | null;
  now: Date;
}

/**
 * A collector that turns live data into events. Register a new source to add
 * event types — do not rewrite the store, hook, or panel.
 */
export interface NotificationSource {
  id: string;
  collect(ctx: NotificationCollectContext): Promise<NotificationEvent[]>;
}

export interface NotificationIdentity {
  email?: string;
  wallet?: string | null;
  authMode?: string | null;
}

export function isPersistedNotificationKind(kind: string): boolean {
  return (AUTHORED_NOTIFICATION_KINDS as readonly string[]).includes(kind);
}
