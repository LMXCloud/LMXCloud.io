import type { OpsIrregularity, OpsNotification, OpsUsageDay } from "./types";

export type ComposeBroadcastKind = "product_update" | "company_update";

export type NotificationSuggestion = {
  id: string;
  title: string;
  reason: string;
  kind: ComposeBroadcastKind;
  writerInstruction: string;
};

/** Days without a product/company broadcast before we nudge. */
export const STALE_UPDATE_DAYS = 14;

const USAGE_JUMP_RATIO = 2;
const USAGE_JUMP_MIN_LATEST = 20;
const USAGE_JUMP_MIN_MEDIAN = 10;
const SIGNUP_WINDOW_MS = 2 * 24 * 60 * 60 * 1000;
const SIGNUP_JUMP_MIN_RECENT = 3;

const USER_FACING_CRITICAL_CATEGORIES = new Set([
  "health",
  "usage",
  "payments",
  "mcp",
]);

export function collectNotificationSuggestions(input: {
  history: OpsNotification[];
  irregularities?: OpsIrregularity[];
  usageHistory?: OpsUsageDay[];
  recentSignups?: Array<{ createdAt: string }>;
  now?: Date;
}): NotificationSuggestion[] {
  const now = input.now ?? new Date();
  const out: NotificationSuggestion[] = [];

  out.push(...staleUpdateSuggestion(input.history, now));
  out.push(...irregularitySuggestions(input.irregularities ?? []));
  out.push(...usageJumpSuggestion(input.usageHistory ?? []));
  out.push(...signupJumpSuggestion(input.recentSignups ?? [], now));

  return out;
}

function staleUpdateSuggestion(
  history: OpsNotification[],
  now: Date,
): NotificationSuggestion[] {
  const authored = history
    .filter(
      (row) => row.kind === "product_update" || row.kind === "company_update",
    )
    .slice()
    .sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
  const latest = authored[0];
  if (!latest) {
    return [
      {
        id: "stale-update",
        title: "First product update",
        reason: "No product or company update has gone out yet.",
        kind: "product_update",
        writerInstruction:
          "Draft a short product update for the console. This is the first changelog broadcast. Cover one real thing users can do today — not a vision dump. Title under 80 characters.",
      },
    ];
  }

  const ageMs = now.getTime() - new Date(latest.createdAt).getTime();
  const days = Math.floor(ageMs / (24 * 60 * 60 * 1000));
  if (!Number.isFinite(days) || days < STALE_UPDATE_DAYS) return [];

  return [
    {
      id: "stale-update",
      title: "Changelog is stale",
      reason: `It's been ${days} days since the last product/company update (“${latest.title}”).`,
      kind: "product_update",
      writerInstruction: `Draft a product update. It's been ${days} days since the last console changelog (“${latest.title}”). Cover one concrete improvement or fix. No fluff. Title under 80 characters.`,
    },
  ];
}

function irregularitySuggestions(
  irregularities: OpsIrregularity[],
): NotificationSuggestion[] {
  const hits = irregularities.filter(
    (item) =>
      USER_FACING_CRITICAL_CATEGORIES.has(item.category) &&
      (item.severity === "critical" || item.id === "health.partial"),
  );

  return hits.slice(0, 2).map((item) => ({
    id: `irregularity:${item.id}`,
    title: item.title,
    reason: item.detail,
    kind: "company_update" as const,
    writerInstruction: `Draft a calm company update for console users. Situation: ${item.title}. ${item.detail} Do not mention internal ops IDs or Telegram. Say what's affected, what still works, and that we're on it. Title under 80 characters.`,
  }));
}

function usageJumpSuggestion(history: OpsUsageDay[]): NotificationSuggestion[] {
  const sorted = [...history].sort((a, b) =>
    a.date < b.date ? -1 : a.date > b.date ? 1 : 0,
  );
  if (sorted.length < 4) return [];

  const prior = sorted.slice(0, -1).map((day) => day.requests);
  const latest = sorted[sorted.length - 1]!;
  const median = [...prior].sort((a, b) => a - b)[Math.floor(prior.length / 2)] ?? 0;
  if (
    median < USAGE_JUMP_MIN_MEDIAN ||
    latest.requests < USAGE_JUMP_MIN_LATEST ||
    latest.requests < median * USAGE_JUMP_RATIO
  ) {
    return [];
  }

  return [
    {
      id: "usage-jump",
      title: "Traffic jumped",
      reason: `${latest.date} had ${latest.requests} requests vs a prior-day median of ${median}.`,
      kind: "product_update",
      writerInstruction: `Draft a product update. Requests jumped to ${latest.requests} on ${latest.date} vs a typical ${median}/day. Don't hype vanity metrics. Tell users routing is absorbing the load and point them at /status if they want the live picture. Title under 80 characters.`,
    },
  ];
}

function signupJumpSuggestion(
  signups: Array<{ createdAt: string }>,
  now: Date,
): NotificationSuggestion[] {
  if (signups.length === 0) return [];

  const cutoffRecent = now.getTime() - SIGNUP_WINDOW_MS;
  const cutoffPrior = cutoffRecent - SIGNUP_WINDOW_MS;
  let recent = 0;
  let prior = 0;
  for (const row of signups) {
    const at = new Date(row.createdAt).getTime();
    if (!Number.isFinite(at)) continue;
    if (at >= cutoffRecent) recent += 1;
    else if (at >= cutoffPrior) prior += 1;
  }

  if (recent < SIGNUP_JUMP_MIN_RECENT || recent < Math.max(prior, 1) * 2) {
    return [];
  }

  return [
    {
      id: "signup-jump",
      title: "Signups jumped",
      reason: `${recent} new accounts in the last two days vs ${prior} in the two days before that.`,
      kind: "company_update",
      writerInstruction: `Draft a company update. ${recent} accounts signed up in the last two days (vs ${prior} in the two days before). Welcome them without sounding like marketing. Point at getting an API key and /docs. Title under 80 characters.`,
    },
  ];
}
