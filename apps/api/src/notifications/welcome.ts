import { hasPostgres } from "../ops/queries.js";
import { notificationAccountId } from "./account-id.js";
import { getWelcomeTemplate, insertWelcomeOnce } from "./store.js";

export function queueWelcomeNotification(input: {
  apiKeyId: string;
  email?: string | null;
  wallet?: string | null;
}): void {
  void insertWelcomeNotification(input).catch(() => {
    /* welcome insert must never fail the request path */
  });
}

export async function insertWelcomeNotification(input: {
  apiKeyId: string;
  email?: string | null;
  wallet?: string | null;
}): Promise<void> {
  if (!hasPostgres()) return;

  const template = await getWelcomeTemplate();
  if (!template) return;

  await insertWelcomeOnce({
    title: template.title,
    body: template.body,
    href: template.href,
    target: notificationAccountId({
      id: input.apiKeyId,
      email: input.email,
      wallet: input.wallet,
    }),
  });
}
