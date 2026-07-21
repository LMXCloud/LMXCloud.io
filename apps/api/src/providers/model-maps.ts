import { aliasKeys, buildProviderModelMap } from "@lmxcloud/shared";
import { ProviderError } from "./types.js";

export const IONET_MODEL_MAP = buildProviderModelMap("ionet");
export const AKASH_MODEL_MAP = buildProviderModelMap("akash");
export const NOSANA_MODEL_MAP = buildProviderModelMap("nosana");

/**
 * Aethir Mesh — optional Tier 2 DePIN when AETHIR_API_KEY is set.
 * Verified live GET /v1/models (2026-07-21): 14 models; mesh uses short
 * lowercase IDs (e.g. minimax-m2.5), not HuggingFace paths or docs' mixed case.
 */
export const AETHIR_MODEL_MAP: Record<string, string> = {
  "deepseek-v4-pro": "deepseek-v4-pro",
  "deepseek-v4-flash": "deepseek-v4-flash",
  "deepseek-v3.2": "deepseek-v3.2",
  "kimi-k2.6": "kimi-k2.6",
  "kimi-k2.5": "kimi-k2.5",
  "glm-5": "glm-5",
  "glm-5.1": "glm-5.1",
  "minimax-m2.5": "minimax-m2.5",
  "qwen-3.6-27b": "qwen3.6-27b",
  "qwen3.6-27b": "qwen3.6-27b",
  "qwen-3.6-35b": "qwen3.6-35b-a3b",
  "qwen3.6-35b-a3b": "qwen3.6-35b-a3b",
};

/** Together tier — optional fallback when TOGETHER_API_KEY is set. */
export const TOGETHER_MODEL_MAP: Record<string, string> = {
  "llama-3-70b": "meta-llama/Llama-3.3-70B-Instruct-Turbo",
  "llama-3.3-70b": "meta-llama/Llama-3.3-70B-Instruct-Turbo",
  "meta-llama/Llama-3.3-70B-Instruct-Turbo":
    "meta-llama/Llama-3.3-70B-Instruct-Turbo",
};

export { aliasKeys };

export function resolveProviderModel(
  map: Record<string, string>,
  provider: string,
  model: string,
): string {
  const upstream = map[model];
  if (!upstream) {
    throw new ProviderError(
      `Model "${model}" is not supported by ${provider}`,
      provider,
      400,
    );
  }
  return upstream;
}
