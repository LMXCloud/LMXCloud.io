import type { ChatCompletionRequest, ChatCompletionResponse } from "@lmxcloud/shared";

export interface ProviderResult {
  response: ChatCompletionResponse;
  latencyMs: number;
}

export interface ProviderHealthResult {
  healthy: boolean;
  latencyMs: number | null;
}

export interface ProviderAdapter {
  readonly name: string;
  readonly tier: number;
  readonly costPer1kTokens: number;
  readonly isDepin: boolean;
  chatCompletion(request: ChatCompletionRequest): Promise<ProviderResult>;
  healthCheck(): Promise<ProviderHealthResult>;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly provider: string,
    public readonly statusCode?: number,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

export class AllProvidersDownError extends Error {
  constructor(public readonly depinOnly: boolean) {
    super(
      depinOnly
        ? "All DePIN providers unavailable"
        : "All providers unavailable",
    );
    this.name = "AllProvidersDownError";
  }
}
