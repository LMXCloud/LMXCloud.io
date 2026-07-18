import { aliasKeys, buildProviderModelMap } from "@lmxcloud/shared";
import { ProviderError } from "./types.js";

export const IONET_MODEL_MAP = buildProviderModelMap("ionet");
export const AKASH_MODEL_MAP = buildProviderModelMap("akash");
export const NOSANA_MODEL_MAP = buildProviderModelMap("nosana");

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
