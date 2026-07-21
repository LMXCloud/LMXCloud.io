import { createOpenAiCompatibleAdapter } from "./openai-compatible.js";
import { aliasKeys, AETHIR_MODEL_MAP, resolveProviderModel } from "./model-maps.js";

const ALIASES = aliasKeys(AETHIR_MODEL_MAP);

export interface AethirConfig {
  apiKey: string;
  baseUrl: string;
}

export function createAethirAdapter(config: AethirConfig) {
  return createOpenAiCompatibleAdapter({
    name: "aethir",
    tier: 2,
    costPer1kTokens: 0.0001,
    isDepin: true,
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
    resolveModel: (model) => resolveProviderModel(AETHIR_MODEL_MAP, "aethir", model),
    aliases: ALIASES,
  });
}
