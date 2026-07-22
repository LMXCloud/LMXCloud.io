import type { OpsActivityItem, OpsIrregularity } from "./types";

export type RecordKind = "payment" | "usage" | "mcp";

export function recordPath(kind: RecordKind, id: string): string {
  if (kind === "payment") return `/payments/${encodeURIComponent(id)}`;
  if (kind === "usage") return `/usage/${encodeURIComponent(id)}`;
  return `/mcp/${encodeURIComponent(id)}`;
}

export function activityPath(item: OpsActivityItem): string | null {
  if (item.kind === "payment") return recordPath("payment", item.id);
  if (item.kind === "usage") return recordPath("usage", item.id);
  if (item.kind === "mcp") return recordPath("mcp", item.id);
  return null;
}

/** Map alert relatedIds to detail routes when they are entity IDs. */
export function relatedIdPath(
  item: OpsIrregularity,
  id: string,
): string | null {
  if (item.category === "payments") return recordPath("payment", id);
  if (item.category === "mcp") return recordPath("mcp", id);
  return null;
}
