type LogLevel = "info" | "warn" | "error";

type ToolLogEvent = {
  level?: LogLevel;
  tool: string;
  callerId: string;
  source: string;
  ok: boolean;
  latencyMs?: number;
  detail?: string;
};

export function logToolEvent(event: ToolLogEvent): void {
  const payload = {
    ts: new Date().toISOString(),
    service: "lmxcloud-mcp",
    level: event.level ?? (event.ok ? "info" : "error"),
    tool: event.tool,
    caller_id: event.callerId,
    auth_source: event.source,
    ok: event.ok,
    latency_ms: event.latencyMs,
    detail: event.detail,
  };

  const line = JSON.stringify(payload);
  if (payload.level === "error") {
    process.stderr.write(`${line}\n`);
    return;
  }
  process.stderr.write(`${line}\n`);
}
