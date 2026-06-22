export interface ProviderStatus {
  healthy: boolean;
  latency: number | null;
  tier: number;
  is_depin: boolean;
  last_check: string | null;
}

export interface StatusResponse {
  object: string;
  providers: Record<string, ProviderStatus>;
  fallback_chain: string[];
}

export interface ChatCompletionResponse {
  choices: Array<{
    message: { role: string; content: string };
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface ApiError {
  error: { message: string; type: string; code?: string };
}

export interface LmxHeaders {
  provider: string;
  fallback: boolean;
  latencyMs: number;
}

export interface RequestLogEntry {
  id: string;
  time: Date;
  provider: string;
  latencyMs: number;
  fallback: boolean;
  error?: string;
}

export type RouteOption =
  | "default"
  | "cheapest"
  | "fastest"
  | "depin-only"
  | "provider:ionet"
  | "provider:akash";
