import { getPool } from "../db/pool.js";
import { hasPostgres } from "../ops/queries.js";
import type { AuthoredNotificationKind } from "@lmxcloud/shared";

export type NotificationRow = {
  id: string;
  kind: AuthoredNotificationKind;
  title: string;
  body: string;
  href: string | null;
  hrefLabel: string | null;
  createdAt: string;
  createdBy: string;
  target: string | null;
  visibleAt: string;
  expiresAt: string | null;
  readCount?: number;
};

export type WelcomeTemplate = {
  kind: "welcome";
  title: string;
  body: string;
  href: string | null;
  updatedAt: string;
  updatedBy: string | null;
};

export type NotificationReadRow = {
  notificationId: string;
  userId: string;
  readAt: string | null;
  seenAt: string;
  fingerprint: string;
  dismissedAt: string | null;
};

interface DbNotification {
  id: string;
  kind: string;
  title: string;
  body: string;
  href: string | null;
  href_label: string | null;
  created_at: Date | string;
  created_by: string;
  target: string | null;
  visible_at: Date | string;
  expires_at: Date | string | null;
  read_count?: string | number;
}

interface DbTemplate {
  kind: string;
  title: string;
  body: string;
  href: string | null;
  updated_at: Date | string;
  updated_by: string | null;
}

interface DbRead {
  notification_id: string;
  user_id: string;
  read_at: Date | string | null;
  seen_at: Date | string;
  fingerprint: string;
  dismissed_at: Date | string | null;
}

function iso(value: Date | string): string {
  if (typeof value === "string") return new Date(value).toISOString();
  return value.toISOString();
}

function isoOrNull(value: Date | string | null): string | null {
  if (value == null) return null;
  return iso(value);
}

function mapNotification(row: DbNotification): NotificationRow {
  return {
    id: row.id,
    kind: row.kind as AuthoredNotificationKind,
    title: row.title,
    body: row.body,
    href: row.href,
    hrefLabel: row.href_label,
    createdAt: iso(row.created_at),
    createdBy: row.created_by,
    target: row.target,
    visibleAt: iso(row.visible_at ?? row.created_at),
    expiresAt: isoOrNull(row.expires_at),
    readCount:
      row.read_count == null ? undefined : Number(row.read_count),
  };
}

function mapTemplate(row: DbTemplate): WelcomeTemplate {
  return {
    kind: "welcome",
    title: row.title,
    body: row.body,
    href: row.href,
    updatedAt: iso(row.updated_at),
    updatedBy: row.updated_by,
  };
}

function mapRead(row: DbRead): NotificationReadRow {
  return {
    notificationId: row.notification_id,
    userId: row.user_id,
    readAt: isoOrNull(row.read_at),
    seenAt: iso(row.seen_at),
    fingerprint: row.fingerprint,
    dismissedAt: isoOrNull(row.dismissed_at),
  };
}

const NOTIFICATION_COLUMNS = `id, kind, title, body, href, href_label, created_at, created_by, target, visible_at, expires_at`;

export async function insertNotification(input: {
  kind: AuthoredNotificationKind;
  title: string;
  body: string;
  href: string | null;
  hrefLabel?: string | null;
  createdBy: string;
  target: string | null;
  visibleAt?: string | null;
  expiresAt?: string | null;
}): Promise<NotificationRow> {
  if (!hasPostgres()) {
    throw new Error("DATABASE_URL is required to create notifications");
  }
  const result = await getPool().query<DbNotification>(
    `INSERT INTO notifications (kind, title, body, href, href_label, created_by, target, visible_at, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8::timestamptz, NOW()), $9)
     RETURNING ${NOTIFICATION_COLUMNS}`,
    [
      input.kind,
      input.title,
      input.body,
      input.href,
      input.hrefLabel ?? null,
      input.createdBy,
      input.target,
      input.visibleAt ?? null,
      input.expiresAt ?? null,
    ],
  );
  const row = result.rows[0];
  if (!row) throw new Error("Insert returned no row");
  return mapNotification(row);
}

export async function insertWelcomeOnce(input: {
  title: string;
  body: string;
  href: string | null;
  target: string;
}): Promise<NotificationRow | null> {
  if (!hasPostgres()) return null;
  const result = await getPool().query<DbNotification>(
    `INSERT INTO notifications (kind, title, body, href, created_by, target)
     SELECT 'welcome', $1, $2, $3, 'system', $4
     WHERE NOT EXISTS (
       SELECT 1 FROM notifications
       WHERE kind = 'welcome' AND target = $4
     )
     RETURNING ${NOTIFICATION_COLUMNS}`,
    [input.title, input.body, input.href, input.target],
  );
  const row = result.rows[0];
  return row ? mapNotification(row) : null;
}

export async function listNotificationsForUser(
  accountIds: string[],
  now = new Date(),
): Promise<NotificationRow[]> {
  if (!hasPostgres() || accountIds.length === 0) return [];
  const result = await getPool().query<DbNotification>(
    `SELECT ${NOTIFICATION_COLUMNS}
     FROM notifications
     WHERE (target IS NULL OR target = ANY($1::text[]))
       AND visible_at <= $2::timestamptz
       AND (expires_at IS NULL OR expires_at > $2::timestamptz)
     ORDER BY created_at DESC`,
    [accountIds, now.toISOString()],
  );
  return result.rows.map(mapNotification);
}

export async function listOpsNotifications(limit = 100): Promise<NotificationRow[]> {
  if (!hasPostgres()) return [];
  const result = await getPool().query<DbNotification>(
    `SELECT n.id, n.kind, n.title, n.body, n.href, n.href_label, n.created_at, n.created_by, n.target,
            n.visible_at, n.expires_at,
            COUNT(r.user_id) FILTER (WHERE r.read_at IS NOT NULL)::int AS read_count
     FROM notifications n
     LEFT JOIN notification_reads r ON r.notification_id = n.id::text
     GROUP BY n.id
     ORDER BY n.created_at DESC
     LIMIT $1`,
    [Math.max(1, Math.min(limit, 200))],
  );
  return result.rows.map(mapNotification);
}

export async function getWelcomeTemplate(): Promise<WelcomeTemplate | null> {
  if (!hasPostgres()) return null;
  const result = await getPool().query<DbTemplate>(
    `SELECT kind, title, body, href, updated_at, updated_by
     FROM notification_templates
     WHERE kind = 'welcome'`,
  );
  const row = result.rows[0];
  return row ? mapTemplate(row) : null;
}

export async function updateWelcomeTemplate(input: {
  title: string;
  body: string;
  href: string | null;
  updatedBy: string;
}): Promise<WelcomeTemplate> {
  if (!hasPostgres()) {
    throw new Error("DATABASE_URL is required to edit notification copy");
  }
  const result = await getPool().query<DbTemplate>(
    `INSERT INTO notification_templates (kind, title, body, href, updated_at, updated_by)
     VALUES ('welcome', $1, $2, $3, NOW(), $4)
     ON CONFLICT (kind) DO UPDATE
       SET title = EXCLUDED.title,
           body = EXCLUDED.body,
           href = EXCLUDED.href,
           updated_at = NOW(),
           updated_by = EXCLUDED.updated_by
     RETURNING kind, title, body, href, updated_at, updated_by`,
    [input.title, input.body, input.href, input.updatedBy],
  );
  const row = result.rows[0];
  if (!row) throw new Error("Welcome template upsert returned no row");
  return mapTemplate(row);
}

export async function listReadsForUser(
  userId: string,
): Promise<NotificationReadRow[]> {
  if (!hasPostgres()) return [];
  const result = await getPool().query<DbRead>(
    `SELECT notification_id, user_id, read_at, seen_at, fingerprint, dismissed_at
     FROM notification_reads
     WHERE user_id = $1`,
    [userId],
  );
  return result.rows.map(mapRead);
}

export async function upsertSeen(input: {
  userId: string;
  items: Array<{ id: string; fingerprint: string }>;
}): Promise<NotificationReadRow[]> {
  if (!hasPostgres() || input.items.length === 0) return listReadsForUser(input.userId);

  const ids = input.items.map((item) => item.id);
  const fingerprints = input.items.map((item) => item.fingerprint);

  await getPool().query(
    `INSERT INTO notification_reads (notification_id, user_id, fingerprint, seen_at)
     SELECT id, $1, fp, NOW()
     FROM unnest($2::text[], $3::text[]) AS t(id, fp)
     ON CONFLICT (notification_id, user_id) DO UPDATE
       SET fingerprint = EXCLUDED.fingerprint,
           seen_at = CASE
             WHEN notification_reads.fingerprint = EXCLUDED.fingerprint
               THEN notification_reads.seen_at
             ELSE EXCLUDED.seen_at
           END,
           read_at = CASE
             WHEN notification_reads.fingerprint = EXCLUDED.fingerprint
               THEN notification_reads.read_at
             ELSE NULL
           END,
           dismissed_at = CASE
             WHEN notification_reads.fingerprint = EXCLUDED.fingerprint
               THEN notification_reads.dismissed_at
             ELSE NULL
           END`,
    [input.userId, ids, fingerprints],
  );

  return listReadsForUser(input.userId);
}

export async function markNotificationsRead(input: {
  userId: string;
  items: Array<{ id: string; fingerprint: string }>;
}): Promise<void> {
  if (!hasPostgres() || input.items.length === 0) return;

  const ids = input.items.map((item) => item.id);
  const fingerprints = input.items.map((item) => item.fingerprint);

  await getPool().query(
    `INSERT INTO notification_reads (notification_id, user_id, fingerprint, seen_at, read_at)
     SELECT id, $1, fp, NOW(), NOW()
     FROM unnest($2::text[], $3::text[]) AS t(id, fp)
     ON CONFLICT (notification_id, user_id) DO UPDATE
       SET fingerprint = EXCLUDED.fingerprint,
           read_at = NOW(),
           seen_at = CASE
             WHEN notification_reads.fingerprint = EXCLUDED.fingerprint
               THEN notification_reads.seen_at
             ELSE EXCLUDED.seen_at
           END`,
    [input.userId, ids, fingerprints],
  );
}

export async function dismissNotifications(input: {
  userId: string;
  items: Array<{ id: string; fingerprint: string }>;
}): Promise<void> {
  if (!hasPostgres() || input.items.length === 0) return;

  const ids = input.items.map((item) => item.id);
  const fingerprints = input.items.map((item) => item.fingerprint);

  await getPool().query(
    `INSERT INTO notification_reads (notification_id, user_id, fingerprint, seen_at, read_at, dismissed_at)
     SELECT id, $1, fp, NOW(), NOW(), NOW()
     FROM unnest($2::text[], $3::text[]) AS t(id, fp)
     ON CONFLICT (notification_id, user_id) DO UPDATE
       SET fingerprint = EXCLUDED.fingerprint,
           read_at = NOW(),
           dismissed_at = NOW(),
           seen_at = CASE
             WHEN notification_reads.fingerprint = EXCLUDED.fingerprint
               THEN notification_reads.seen_at
             ELSE EXCLUDED.seen_at
           END`,
    [input.userId, ids, fingerprints],
  );
}
