import { createOpenAiCompatibleAdapter } from "./openai-compatible.js";

const MODEL_MAP: Record<string, string> = {
  "llama-3-70b": "meta-llama/Llama-3.3-70B-Instruct",
  "llama-3.3-70b": "meta-llama/Llama-3.3-70B-Instruct",
  "meta-llama/Llama-3.3-70B-Instruct": "meta-llama/Llama-3.3-70B-Instruct",
};

export interface AkashConfig {
  apiKey: string;
  baseUrl: string;
}

export function createAkashAdapter(config: AkashConfig) {
  return createOpenAiCompatibleAdapter({
    name: "akash",
    tier: 2,
    costPer1kTokens: 0.0001,
    isDepin: true,
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
    resolveModel: (model) => MODEL_MAP[model] ?? model,
  });
}
