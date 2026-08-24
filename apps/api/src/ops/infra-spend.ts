import type { InfraSpendEntry } from "./infra-spend-store.js";
import type { LiveSpendPoint } from "./infra-spend-live.js";

export type InfraSpendMonth = {
  date: string;
  amount: number;
  liveUsd: number;
  manualUsd: number;
};

export function monthKeys(count: number, now = new Date()): string[] {
  const keys: string[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const m = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    keys.push(`${m.getUTCFullYear()}-${String(m.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return keys;
}

function entryMonth(date: string): string {
  return date.slice(0, 7);
}

/**
 * Monthly spend series. Live current-cycle figures replace the same
 * service's manual spend for that month so they are never summed together.
 * Balance/note rows are excluded — they are not payments.
 */
export function buildSpendSeries(
  entries: InfraSpendEntry[],
  live: LiveSpendPoint[],
  months: number,
  now = new Date(),
): InfraSpendMonth[] {
  const keys = monthKeys(months, now);
  const liveByMonthService = new Map<string, number>();
  for (const point of live) {
    const key = `${point.month}:${point.service}`;
    liveByMonthService.set(key, (liveByMonthService.get(key) ?? 0) + point.amountUsd);
  }

  const liveServicesByMonth = new Map<string, Set<string>>();
  for (const point of live) {
    const set = liveServicesByMonth.get(point.month) ?? new Set<string>();
    set.add(point.service);
    liveServicesByMonth.set(point.month, set);
  }

  const manualByMonth = new Map<string, number>();
  for (const entry of entries) {
    if (entry.kind !== "spend") continue;
    const month = entryMonth(entry.date);
    if (liveServicesByMonth.get(month)?.has(entry.service)) continue;
    manualByMonth.set(month, (manualByMonth.get(month) ?? 0) + entry.amount);
  }

  return keys.map((date) => {
    let liveUsd = 0;
    for (const [key, amount] of liveByMonthService) {
      if (key.startsWith(`${date}:`)) liveUsd += amount;
    }
    const manualUsd = manualByMonth.get(date) ?? 0;
    return {
      date,
      liveUsd,
      manualUsd,
      amount: liveUsd + manualUsd,
    };
  });
}
