export const AGENT_ACTIVE_WITHIN_MS = 15 * 60 * 1000;
export const AGENT_IDLE_WITHIN_MS = 24 * 60 * 60 * 1000;

export type AgentStatus = "Active" | "Idle" | "Offline";

export function agentStatus(lastUsedAt: string | null, now = Date.now()): AgentStatus {
  if (!lastUsedAt) return "Offline";
  const then = new Date(lastUsedAt).getTime();
  if (!Number.isFinite(then)) return "Offline";
  const age = now - then;
  if (age <= AGENT_ACTIVE_WITHIN_MS) return "Active";
  if (age <= AGENT_IDLE_WITHIN_MS) return "Idle";
  return "Offline";
}

export function isAgentConnected(lastUsedAt: string | null, sinceMs?: number): boolean {
  if (!lastUsedAt) return false;
  const then = new Date(lastUsedAt).getTime();
  if (!Number.isFinite(then)) return false;
  if (sinceMs === undefined) return true;
  return then >= sinceMs;
}

export function statusDotClass(status: AgentStatus): string {
  if (status === "Active") return "bg-success";
  if (status === "Idle") return "bg-warning";
  return "bg-on-surface-faint";
}

export function statusChipTone(status: AgentStatus): "success" | "warning" | "default" {
  if (status === "Active") return "success";
  if (status === "Idle") return "warning";
  return "default";
}
