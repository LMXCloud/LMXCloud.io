export const NOTIFICATION_KINDS = {
  PROVIDER_HEALTH: "provider_health",
  LOW_BALANCE: "low_balance",
  KEY_EXPIRING: "key_expiring",
} as const;

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
  /**
   * Snapshot of the underlying signal. A previously-read item becomes unread
   * again when this changes (e.g. a different set of providers is down).
   */
  fingerprint: string;
  /** ISO time the condition was first observed in this browser, when known. */
  observedAt: string;
}

export interface NotificationItem extends NotificationEvent {
  unread: boolean;
  readAt: string | null;
}

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
