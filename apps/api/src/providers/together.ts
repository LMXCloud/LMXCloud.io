import { createOpenAiCompatibleAdapter } from "./openai-compatible.js";
import { aliasKeys, resolveProviderModel, TOGETHER_MODEL_MAP } from "./model-maps.js";

const ALIASES = aliasKeys(TOGETHER_MODEL_MAP);

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
    resolveModel: (model) => resolveProviderModel(TOGETHER_MODEL_MAP, "together", model),
    aliases: ALIASES,
  });
}
