import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  UsageInfo,
} from "@lmxcloud/shared";

export interface ProviderResult {
  response: ChatCompletionResponse;
  latencyMs: number;
  usage: UsageInfo | null;
  stream?: AsyncIterable<string>;
}

export interface ProviderHealthResult {
  healthy: boolean;
  latencyMs: number | null;
  /** HTTP status from the gateway probe, when a response was received. */
  statusCode?: number;
  /** Short upstream error snippet (e.g. JSON `detail` field). */
  errorDetail?: string;
  /** URL probed for this result (first failing or successful probe). */
  checkUrl?: string;
}

export interface ProviderAdapter {
  readonly name: string;
  readonly tier: number;
  readonly costPer1kTokens: number;
  readonly isDepin: boolean;
  readonly aliases: string[];
  supportsModel(model: string): boolean;
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

export class ModelNotSupportedError extends Error {
  constructor(public readonly model: string) {
    super(`Model "${model}" is not supported by any configured provider`);
    this.name = "ModelNotSupportedError";
  }
}
