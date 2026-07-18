/**
 * Resource-type-agnostic telemetry labels.
 * New providers inherit tracking via InferenceRouter; new resource types
 * pass their own label when calling the shared recorder — no per-integration wiring.
 */
export const RESOURCE_TYPE_CHAT = "chat";

/**
 * Centralized web search passthrough (Brave), not a DePIN ProviderAdapter call.
 *
 * Coverage decision (Goal 0b, 2026-07-18):
 * - YES: record success/failure on usage_events with this resource_type so ops can
 *   filter latency/error rates for the Brave dependency.
 * - NO: do not fold into the DePIN multi-network reliability claim on /v1/status —
 *   that claim is about independent DePIN compute networks (io.net/Akash/…), not a
 *   single centralized search vendor. Vision-on-chat inherits chat telemetry via
 *   InferenceRouter automatically; web_search must record in-route instead.
 */
export const RESOURCE_TYPE_WEB_SEARCH = "web_search";

export type ResourceType = string;

export interface ReliabilitySeriesPoint {
  date: string;
  resourceType: string;
  provider: string;
  model: string;
  attempts: number;
  successes: number;
  failures: number;
  successRate: number;
  avgLatencyMs: number | null;
  avgUnitPrice: number | null;
  avgCost: number | null;
}

export interface ReliabilityProviderSummary {
  resourceType: string;
  provider: string;
  attempts: number;
  successes: number;
  failures: number;
  successRate: number;
  avgLatencyMs: number | null;
  avgUnitPrice: number | null;
}

export interface ReliabilityTelemetry {
  object: "reliability_telemetry";
  windowDays: number;
  resourceType: string | null;
  overall: {
    attempts: number;
    successes: number;
    failures: number;
    successRate: number;
    avgLatencyMs: number | null;
    avgUnitPrice: number | null;
  };
  byProvider: ReliabilityProviderSummary[];
  series: ReliabilitySeriesPoint[];
}
