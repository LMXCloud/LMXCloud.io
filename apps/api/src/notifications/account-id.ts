export function notificationAccountId(record: {
  id: string;
  email?: string | null;
  wallet?: string | null;
}): string {
  const email = record.email?.trim().toLowerCase();
  if (email) return `email:${email}`;
  const wallet = record.wallet?.trim().toLowerCase();
  if (wallet) return `wallet:${wallet}`;
  return `key:${record.id}`;
}

export function notificationAccountIds(
  record: {
    id: string;
    email?: string | null;
    wallet?: string | null;
  },
  keys: Array<{ id: string }> = [],
): string[] {
  const ids = new Set<string>();
  ids.add(notificationAccountId(record));
  const email = record.email?.trim().toLowerCase();
  const wallet = record.wallet?.trim().toLowerCase();
  if (email) ids.add(`email:${email}`);
  if (wallet) ids.add(`wallet:${wallet}`);
  for (const key of keys) {
    ids.add(`key:${key.id}`);
  }
  return [...ids];
}
