export type McpToolEvent = {
  id: string;
  ts: string;
  tool: string;
  callerId: string;
  authSource: string;
  ok: boolean;
  level: "info" | "warn" | "error";
  latencyMs?: number;
  detail?: string;
};

export type McpToolEventInput = {
  ts?: string;
  tool: string;
  callerId: string;
  authSource: string;
  ok: boolean;
  level?: "info" | "warn" | "error";
  latencyMs?: number;
  detail?: string;
};

const MAX_EVENTS = 500;
const events: McpToolEvent[] = [];
let seq = 0;

export function ingestMcpToolEvent(input: McpToolEventInput): McpToolEvent {
  seq += 1;
  const event: McpToolEvent = {
    id: `mcp_${Date.now()}_${seq}`,
    ts: input.ts ?? new Date().toISOString(),
    tool: input.tool,
    callerId: input.callerId,
    authSource: input.authSource,
    ok: input.ok,
    level: input.level ?? (input.ok ? "info" : "error"),
    latencyMs: input.latencyMs,
    detail: input.detail,
  };

  events.unshift(event);
  if (events.length > MAX_EVENTS) {
    events.length = MAX_EVENTS;
  }
  return event;
}

export function listRecentMcpToolEvents(limit = 50): McpToolEvent[] {
  return events.slice(0, Math.max(1, Math.min(limit, MAX_EVENTS)));
}

export function getMcpToolEventById(id: string): McpToolEvent | null {
  return events.find((event) => event.id === id) ?? null;
}

export function mcpToolEventCount(): number {
  return events.length;
}
