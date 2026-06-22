import type { ChatCompletionRequest } from "@lmxcloud/shared";
import { ProviderError, type ProviderAdapter, type ProviderHealthResult } from "./types.js";

export interface OpenAiCompatibleConfig {
  name: string;
  tier: number;
  costPer1kTokens: number;
  isDepin: boolean;
  apiKey: string;
  baseUrl: string;
  resolveModel: (model: string) => string;
  timeoutMs?: number;
}

export function createOpenAiCompatibleAdapter(config: OpenAiCompatibleConfig): ProviderAdapter {
  const timeoutMs = config.timeoutMs ?? 30_000;

  return {
    name: config.name,
    tier: config.tier,
    costPer1kTokens: config.costPer1kTokens,
    isDepin: config.isDepin,

    async healthCheck(): Promise<ProviderHealthResult> {
      const start = performance.now();

      try {
        const response = await fetch(`${config.baseUrl}/models`, {
          headers: { Authorization: `Bearer ${config.apiKey}` },
          signal: AbortSignal.timeout(timeoutMs),
        });

        return {
          healthy: response.ok,
          latencyMs: Math.round(performance.now() - start),
        };
      } catch {
        return {
          healthy: false,
          latencyMs: null,
        };
      }
    },

    async chatCompletion(request: ChatCompletionRequest) {
      const start = performance.now();
      const upstreamModel = config.resolveModel(request.model);

      const body: Record<string, unknown> = {
        model: upstreamModel,
        messages: request.messages,
        stream: false,
      };

      if (request.temperature !== undefined) {
        body.temperature = request.temperature;
      }

      const maxTokens = request.max_completion_tokens ?? request.max_tokens;
      if (maxTokens !== undefined) {
        body.max_tokens = maxTokens;
        body.max_completion_tokens = maxTokens;
      }

      let response: Response;
      try {
        response = await fetch(`${config.baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${config.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (err) {
        throw new ProviderError(
          `Failed to reach ${config.name} API`,
          config.name,
          undefined,
          err,
        );
      }

      const latencyMs = Math.round(performance.now() - start);

      if (!response.ok) {
        const errorText = await response.text();
        throw new ProviderError(
          `${config.name} returned ${response.status}: ${errorText}`,
          config.name,
          response.status,
        );
      }

      const data = (await response.json()) as Awaited<
        ReturnType<ProviderAdapter["chatCompletion"]>
      >["response"];

      return { response: data, latencyMs };
    },
  };
}
