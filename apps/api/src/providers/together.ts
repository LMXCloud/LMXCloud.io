import { createOpenAiCompatibleAdapter } from "./openai-compatible.js";

const MODEL_MAP: Record<string, string> = {
  "llama-3-70b": "meta-llama/Meta-Llama-3.3-70B-Instruct-Turbo",
  "llama-3.3-70b": "meta-llama/Meta-Llama-3.3-70B-Instruct-Turbo",
  "meta-llama/Meta-Llama-3.3-70B-Instruct-Turbo":
    "meta-llama/Meta-Llama-3.3-70B-Instruct-Turbo",
};

export interface TogetherConfig {
  apiKey: string;
  baseUrl: string;
}

export function createTogetherAdapter(config: TogetherConfig) {
  return createOpenAiCompatibleAdapter({
    name: "together",
    tier: 4,
    costPer1kTokens: 0.0004,
    isDepin: false,
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
    resolveModel: (model) => MODEL_MAP[model] ?? model,
  });
}
