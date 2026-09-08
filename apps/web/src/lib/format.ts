export function formatUsd(amount: number, digits = 6): string {
  return `$${amount.toFixed(digits)}`;
}

export function formatNumber(value: number): string {
  return value.toLocaleString();
}

export function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString([], {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function formatRelativeTime(iso: string, now = Date.now()): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "—";
  const deltaMs = Math.max(0, now - then);
  const seconds = Math.round(deltaMs / 1000);
  if (seconds < 45) return "Just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return formatDate(iso);
}

export function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function formatLatency(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${ms}ms`;
}

export function maskKey(key: string): string {
  if (key.length <= 12) return key;
  return `${key.slice(0, 8)}…${key.slice(-4)}`;
}

export function formatWallet(address: string): string {
  if (address.length <= 12) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function formatApiKeyLabel(key: { name?: string | null; id: string }): string {
  const name = key.name?.trim();
  if (name) return name;
  return `${key.id.slice(0, 8)}…`;
}

export function txExplorerUrl(chain: string, txHash: string): string {
  const base =
    chain === "base-sepolia"
      ? "https://sepolia.basescan.org/tx/"
      : "https://basescan.org/tx/";
  return `${base}${txHash}`;
}

export function txExplorerUrlForChainId(chainId: number, txHash: string): string {
  return txExplorerUrl(chainId === 84532 ? "base-sepolia" : "base", txHash);
}

export function contractExplorerUrl(chainId: number, address: string): string {
  const base =
    chainId === 84532
      ? "https://sepolia.basescan.org/address/"
      : "https://basescan.org/address/";
  return `${base}${address}`;
}
