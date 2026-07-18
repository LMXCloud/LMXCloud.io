export type DepinProvider = "ionet" | "akash" | "nosana";

export type ModelCategory =
  | "meta"
  | "qwen"
  | "deepseek"
  | "glm"
  | "mistral"
  | "kimi"
  | "openai"
  | "google"
  | "minimax"
  | "other";

/** Input modalities the model accepts. Defaults to text-only when omitted. */
export type InputModality = "text" | "image";

export interface SupportedModel {
  /** Short LMX alias used in API requests */
  alias: string;
  /** Human-readable name for marketing / UI */
  label: string;
  /** Provider upstream model ID */
  upstreamId: string;
  providers: DepinProvider[];
  category: ModelCategory;
  /**
   * Confirmed against live provider catalogs (io.net / AkashML).
   * Omitted means text-only.
   */
  inputModalities?: InputModality[];
}

/**
 * Verified via chat completions against io.net + AkashML catalogs (2026-07).
 * Nosana overlap confirmed against official vLLM/LMDeploy/Ollama templates
 * (nosana-ci/pipeline-templates, 2026-07): Llama 70B family, DeepSeek-R1,
 * Qwen 3.5/3.6, GLM 4.7 Flash, GPT-OSS, Gemma 4 26B. Nosana has no shared
 * gateway — only aliases listed in NOSANA_ENDPOINTS (per-deployment /v1 URLs)
 * are actually routable.
 */
export const SUPPORTED_MODELS: SupportedModel[] = [
  {
    alias: "llama-3-70b",
    label: "Llama 3.3 70B Instruct",
    upstreamId: "meta-llama/Llama-3.3-70B-Instruct",
    providers: ["ionet", "akash", "nosana"],
    category: "meta",
  },
  {
    alias: "llama-3.3-70b",
    label: "Llama 3.3 70B Instruct",
    upstreamId: "meta-llama/Llama-3.3-70B-Instruct",
    providers: ["ionet", "akash", "nosana"],
    category: "meta",
  },
  {
    alias: "llama-4-maverick",
    label: "Llama 4 Maverick 17B",
    upstreamId: "meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8",
    providers: ["ionet"],
    category: "meta",
  },
  {
    alias: "llama-3.2-90b-vision",
    label: "Llama 3.2 90B Vision",
    upstreamId: "meta-llama/Llama-3.2-90B-Vision-Instruct",
    providers: ["ionet"],
    category: "meta",
    inputModalities: ["text", "image"],
  },
  {
    alias: "qwen-3.6-35b",
    label: "Qwen 3.6 35B",
    upstreamId: "Qwen/Qwen3.6-35B-A3B",
    providers: ["ionet", "akash", "nosana"],
    category: "qwen",
    inputModalities: ["text", "image"],
  },
  {
    alias: "qwen-3.5-35b",
    label: "Qwen 3.5 35B",
    upstreamId: "Qwen/Qwen3.5-35B-A3B",
    providers: ["akash", "nosana"],
    category: "qwen",
    inputModalities: ["text", "image"],
  },
  {
    alias: "qwen-3.6-27b",
    label: "Qwen 3.6 27B",
    upstreamId: "Qwen/Qwen3.6-27B",
    providers: ["ionet", "nosana"],
    category: "qwen",
  },
  {
    alias: "qwen-3-next-80b",
    label: "Qwen 3 Next 80B",
    upstreamId: "Qwen/Qwen3-Next-80B-A3B-Instruct",
    providers: ["ionet"],
    category: "qwen",
  },
  {
    alias: "qwen3-coder-480b",
    label: "Qwen3 Coder 480B",
    upstreamId: "Intel/Qwen3-Coder-480B-A35B-Instruct-int4-mixed-ar",
    providers: ["ionet"],
    category: "qwen",
  },
  {
    alias: "deepseek-v4-flash",
    label: "DeepSeek V4 Flash",
    upstreamId: "deepseek-ai/DeepSeek-V4-Flash",
    providers: ["ionet", "akash"],
    category: "deepseek",
  },
  {
    alias: "deepseek-v4-pro",
    label: "DeepSeek V4 Pro",
    upstreamId: "deepseek-ai/DeepSeek-V4-Pro",
    providers: ["ionet"],
    category: "deepseek",
  },
  {
    alias: "deepseek-v3.2",
    label: "DeepSeek V3.2",
    upstreamId: "deepseek-ai/DeepSeek-V3.2",
    providers: ["ionet"],
    category: "deepseek",
  },
  {
    alias: "deepseek-r1",
    label: "DeepSeek R1",
    upstreamId: "deepseek-ai/DeepSeek-R1-0528",
    providers: ["ionet", "nosana"],
    category: "deepseek",
  },
  {
    alias: "glm-5.2",
    label: "GLM 5.2",
    upstreamId: "zai-org/GLM-5.2",
    providers: ["ionet", "akash"],
    category: "glm",
  },
  {
    alias: "glm-5.1",
    label: "GLM 5.1",
    upstreamId: "zai-org/GLM-5.1",
    providers: ["ionet"],
    category: "glm",
  },
  {
    alias: "glm-5",
    label: "GLM 5",
    upstreamId: "zai-org/GLM-5",
    providers: ["ionet"],
    category: "glm",
  },
  {
    alias: "glm-4.7",
    label: "GLM 4.7",
    upstreamId: "zai-org/GLM-4.7",
    providers: ["ionet"],
    category: "glm",
  },
  {
    alias: "glm-4.7-flash",
    label: "GLM 4.7 Flash",
    upstreamId: "zai-org/GLM-4.7-Flash",
    providers: ["ionet", "nosana"],
    category: "glm",
  },
  {
    alias: "glm-4.6",
    label: "GLM 4.6",
    upstreamId: "zai-org/GLM-4.6",
    providers: ["ionet"],
    category: "glm",
  },
  {
    alias: "glm-4.5-air",
    label: "GLM 4.5 Air",
    upstreamId: "zai-org/GLM-4.5-Air",
    providers: ["ionet"],
    category: "glm",
  },
  {
    alias: "mistral-nemo",
    label: "Mistral Nemo 12B",
    upstreamId: "mistralai/Mistral-Nemo-Instruct-2407",
    providers: ["ionet"],
    category: "mistral",
  },
  {
    alias: "kimi-k2.5",
    label: "Kimi K2.5",
    upstreamId: "moonshotai/Kimi-K2.5",
    providers: ["ionet"],
    category: "kimi",
  },
  {
    alias: "kimi-k2.6",
    label: "Kimi K2.6",
    upstreamId: "moonshotai/Kimi-K2.6",
    providers: ["ionet"],
    category: "kimi",
  },
  {
    alias: "kimi-k2.7-code",
    label: "Kimi K2.7 Code",
    upstreamId: "moonshotai/Kimi-K2.7-Code",
    providers: ["ionet"],
    category: "kimi",
  },
  {
    alias: "kimi-k2-thinking",
    label: "Kimi K2 Thinking",
    upstreamId: "moonshotai/Kimi-K2-Thinking",
    providers: ["ionet"],
    category: "kimi",
  },
  {
    alias: "kimi-k2-instruct",
    label: "Kimi K2 Instruct",
    upstreamId: "moonshotai/Kimi-K2-Instruct-0905",
    providers: ["ionet"],
    category: "kimi",
  },
  {
    alias: "gpt-oss-120b",
    label: "GPT-OSS 120B",
    upstreamId: "openai/gpt-oss-120b",
    providers: ["ionet", "nosana"],
    category: "openai",
  },
  {
    alias: "gpt-oss-20b",
    label: "GPT-OSS 20B",
    upstreamId: "openai/gpt-oss-20b",
    providers: ["ionet", "nosana"],
    category: "openai",
  },
  {
    alias: "gemma-4-26b",
    label: "Gemma 4 26B",
    upstreamId: "google/gemma-4-26b-a4b-it",
    providers: ["ionet", "nosana"],
    category: "google",
  },
  {
    alias: "minimax-m2.5",
    label: "MiniMax M2.5",
    upstreamId: "MiniMaxAI/MiniMax-M2.5",
    providers: ["ionet"],
    category: "minimax",
  },
];

export function buildProviderModelMap(provider: DepinProvider): Record<string, string> {
  const map: Record<string, string> = {};

  for (const model of SUPPORTED_MODELS) {
    if (!model.providers.includes(provider)) continue;
    map[model.alias] = model.upstreamId;
    map[model.upstreamId] = model.upstreamId;
  }

  return map;
}

export function aliasKeys(map: Record<string, string>): string[] {
  return [...new Set(Object.keys(map))];
}

export const DEFAULT_MODEL_ALIAS = "llama-3-70b";

export const MODEL_CATEGORIES: Record<ModelCategory, string> = {
  meta: "Meta Llama",
  qwen: "Qwen",
  deepseek: "DeepSeek",
  glm: "GLM",
  mistral: "Mistral",
  kimi: "Kimi",
  openai: "OpenAI OSS",
  google: "Google",
  minimax: "MiniMax",
  other: "Other",
};

const PROVIDER_LABELS: Record<DepinProvider, string> = {
  ionet: "io.net",
  akash: "AkashML",
  nosana: "Nosana",
};

export function formatModelProviders(model: SupportedModel): string {
  if (model.providers.length === 1) {
    return `${PROVIDER_LABELS[model.providers[0]!]} only`;
  }
  return model.providers.map((p) => PROVIDER_LABELS[p]).join(" + ");
}

/** Unique aliases (drops duplicate upstream rows like llama-3-70b / llama-3.3-70b). */
export function listUniqueModelAliases(): SupportedModel[] {
  const seen = new Set<string>();
  const result: SupportedModel[] = [];

  for (const model of SUPPORTED_MODELS) {
    if (seen.has(model.alias)) continue;
    seen.add(model.alias);
    result.push(model);
  }

  return result;
}

export function resolveSupportedModel(modelId: string): SupportedModel | undefined {
  return SUPPORTED_MODELS.find(
    (model) => model.alias === modelId || model.upstreamId === modelId,
  );
}

export function modelInputModalities(modelId: string): InputModality[] {
  const model = resolveSupportedModel(modelId);
  return model?.inputModalities ?? ["text"];
}

export function modelSupportsImageInput(modelId: string): boolean {
  return modelInputModalities(modelId).includes("image");
}

/** Unique aliases for models that accept image content parts. */
export function listVisionModelAliases(): string[] {
  return listUniqueModelAliases()
    .filter((model) => (model.inputModalities ?? ["text"]).includes("image"))
    .map((model) => model.alias);
}
