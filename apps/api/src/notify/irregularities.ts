import type { OpsIrregularity } from "../ops/irregularities.js";
import { notifyTelegram } from "./telegram.js";

const DEFAULT_COOLDOWN_MS = 30 * 60 * 1000;

function getCooldownMs(): number {
  const raw = process.env.TELEGRAM_IRREGULARITY_COOLDOWN_MS?.trim();
  if (!raw) return DEFAULT_COOLDOWN_MS;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_COOLDOWN_MS;
}

/** Active critical irregularity ids we have already alerted on. */
const activeCriticalIds = new Set<string>();
/** Last Telegram send time per irregularity id (for cooldown re-alerts). */
const lastNotifiedAt = new Map<string, number>();

function formatCriticalIrregularity(item: OpsIrregularity): string {
  const lines = [
    "🚨 Ops alert (critical)",
    `Title: ${item.title}`,
    `Detail: ${item.detail}`,
    `Action: ${item.action}`,
  ];
  if (item.metric) lines.push(`Metric: ${item.metric}`);
  if (item.category) lines.push(`Category: ${item.category}`);
  return lines.join("\n");
}

/**
 * Fire-and-forget Telegram for critical irregularities.
 * Dedupes steady-state conditions: notifies on first sight and again after cooldown,
 * not on every poll cycle. Clears state when a condition resolves.
 */
export function notifyCriticalIrregularities(irregularities: OpsIrregularity[]): void {
  const critical = irregularities.filter((item) => item.severity === "critical");
  const criticalIds = new Set(critical.map((item) => item.id));
  const now = Date.now();
  const cooldownMs = getCooldownMs();

  for (const id of activeCriticalIds) {
    if (!criticalIds.has(id)) {
      activeCriticalIds.delete(id);
      lastNotifiedAt.delete(id);
    }
  }

  for (const item of critical) {
    const wasActive = activeCriticalIds.has(item.id);
    const lastAt = lastNotifiedAt.get(item.id);

    if (!wasActive) {
      notifyTelegram(formatCriticalIrregularity(item));
      activeCriticalIds.add(item.id);
      lastNotifiedAt.set(item.id, now);
      continue;
    }

    if (lastAt !== undefined && now - lastAt >= cooldownMs) {
      notifyTelegram(formatCriticalIrregularity(item));
      lastNotifiedAt.set(item.id, now);
    }
  }
}

/** Test-only reset of in-process dedupe state. */
export function resetCriticalIrregularityNotifyState(): void {
  activeCriticalIds.clear();
  lastNotifiedAt.clear();
}
