import type { OpsProviderBalance } from "./types";

export function formatUsd(n: number): string {
  if (n >= 1) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(6)}`;
}

export function formatProviderBalance(
  balance: OpsProviderBalance | null | undefined,
): string {
  if (!balance) return "—";
  const obs = balance.observability;
  if (obs.mode === "api") {
    const prefix = balance.belowThreshold ? "⚠ " : "";
    return `${prefix}$${obs.balanceUsd.toFixed(2)}`;
  }
  if (obs.mode === "not_api_observable") {
    return obs.reason;
  }
  return `poll error: ${obs.error}`;
}

export function formatEth(n: number): string {
  if (n >= 0.01) return `${n.toFixed(4)} ETH`;
  if (n >= 0.0001) return `${n.toFixed(6)} ETH`;
  return `${n.toExponential(2)} ETH`;
}

export function formatNum(n: number): string {
  return n.toLocaleString();
}

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return formatNum(n);
}

export function formatLatency(ms: number | null | undefined): string {
  if (ms == null) return "—";
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms)}ms`;
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function shortWallet(addr: string): string {
  if (addr.length <= 12) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function displayValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "yes" : "no";
  return String(value);
}
