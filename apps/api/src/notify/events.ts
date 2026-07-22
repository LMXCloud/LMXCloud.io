import type { UsageStore } from "../usage/store.js";
import { notifyTelegram } from "./telegram.js";

export type AccountCreatedSource =
  | "public_key"
  | "authenticated_key"
  | "siwe"
  | "clerk";

export type CreditSource =
  | "initial"
  | "dev_topup"
  | "usdc_deposit";

const firstRequestNotified = new Set<string>();

function shortId(id: string): string {
  return id.length > 12 ? `${id.slice(0, 8)}…` : id;
}

function identityLine(email?: string | null, wallet?: string | null): string {
  if (email) return `Email: ${email}`;
  if (wallet) return `Wallet: ${wallet}`;
  return "Identity: anonymous";
}

export function notifyAccountCreated(input: {
  apiKeyId: string;
  source: AccountCreatedSource;
  email?: string | null;
  wallet?: string | null;
  isNewAccount?: boolean;
}): void {
  const kind = input.isNewAccount ? "New account" : "New API key";
  const lines = [
    `🔑 ${kind}`,
    `Key: ${shortId(input.apiKeyId)}`,
    identityLine(input.email, input.wallet),
    `Source: ${input.source}`,
  ];
  notifyTelegram(lines.join("\n"));
}

export function notifyCreditsAdded(input: {
  apiKeyId: string;
  amount: number;
  balance: number;
  source: CreditSource;
  detail?: string;
}): void {
  const lines = [
    "💰 Credits added",
    `Key: ${shortId(input.apiKeyId)}`,
    `Amount: +$${input.amount.toFixed(4)}`,
    `Balance: $${input.balance.toFixed(4)}`,
    `Source: ${input.source}`,
  ];
  if (input.detail) lines.push(`Detail: ${input.detail}`);
  notifyTelegram(lines.join("\n"));
}

/**
 * Notify on the first successful API request per key (in-process dedupe + DB check).
 * Ongoing traffic is not notified — avoids chat spam at scale.
 */
export function notifyFirstApiUsage(
  usageStore: UsageStore,
  input: {
    apiKeyId: string;
    provider: string;
    model: string;
    resourceType?: string;
  },
): void {
  if (firstRequestNotified.has(input.apiKeyId)) return;

  void usageStore
    .getUsage(input.apiKeyId)
    .then((stats) => {
      if (!stats || stats.requestCount !== 1) return;
      if (firstRequestNotified.has(input.apiKeyId)) return;
      firstRequestNotified.add(input.apiKeyId);

      const resource = input.resourceType && input.resourceType !== "chat"
        ? `${input.resourceType}/`
        : "";
      notifyTelegram(
        [
          "🚀 First API call",
          `Key: ${shortId(input.apiKeyId)}`,
          `Route: ${resource}${input.provider}/${input.model}`,
        ].join("\n"),
      );
    })
    .catch(() => {
      /* telemetry must never fail the request path */
    });
}
