/** OpenAI reference pricing for equivalent-tier comparison (USD per 1k tokens). */
export interface OpenAiBenchmark {
  label: string;
  inputPer1k: number;
  outputPer1k: number;
}

const BENCHMARKS: Record<string, OpenAiBenchmark> = {
  "llama-3-70b": { label: "GPT-4o", inputPer1k: 0.0025, outputPer1k: 0.01 },
  "llama-3.3-70b": { label: "GPT-4o", inputPer1k: 0.0025, outputPer1k: 0.01 },
  "llama-3-8b": { label: "GPT-4o mini", inputPer1k: 0.00015, outputPer1k: 0.0006 },
  "mistral-7b": { label: "GPT-4o mini", inputPer1k: 0.00015, outputPer1k: 0.0006 },
};

const DEFAULT_BENCHMARK: OpenAiBenchmark = {
  label: "GPT-4o",
  inputPer1k: 0.0025,
  outputPer1k: 0.01,
};

export function getOpenAiBenchmark(model: string): OpenAiBenchmark {
  return BENCHMARKS[model] ?? DEFAULT_BENCHMARK;
}

export function estimateOpenAiCost(
  promptTokens: number,
  completionTokens: number,
  model: string,
): number {
  const bench = getOpenAiBenchmark(model);
  return (
    (promptTokens / 1000) * bench.inputPer1k +
    (completionTokens / 1000) * bench.outputPer1k
  );
}

/** Positive = LMX is cheaper. Negative = LMX costs more. */
export function savingsVsOpenAi(lmxCost: number, openAiCost: number): number {
  if (openAiCost <= 0) return 0;
  return ((openAiCost - lmxCost) / openAiCost) * 100;
}

/** LMX provider rates ($/1k total tokens) — keep in sync with apps/api/src/providers/*.ts */
export const LMX_PROVIDER_RATES = {
  akash: 0.0001,
  ionet: 0.0002,
  together: 0.0004,
} as const;

export const HERO_BENCHMARK_MODEL = "llama-3-70b";

/** Typical chat mix: ~25% prompt, ~75% completion tokens. */
const TYPICAL_INPUT_SHARE = 0.25;

function savingsForLmxRate(
  lmxCostPer1k: number,
  model: string,
  totalTokens = 1000,
  inputShare = TYPICAL_INPUT_SHARE,
): number {
  const promptTokens = totalTokens * inputShare;
  const completionTokens = totalTokens * (1 - inputShare);
  const openAiCost = estimateOpenAiCost(promptTokens, completionTokens, model);
  const lmxCost = (totalTokens / 1000) * lmxCostPer1k;
  return savingsVsOpenAi(lmxCost, openAiCost);
}

/** Floor savings % across all configured LMX routes (conservative hero stat). */
export function getHeroSavingsPercent(model = HERO_BENCHMARK_MODEL): number {
  const rates = Object.values(LMX_PROVIDER_RATES);
  const savings = rates.map((rate) => savingsForLmxRate(rate, model));
  return Math.min(...savings);
}

/** Marketing-safe display, e.g. "95%+" — always rounds down to nearest 5. */
export function formatHeroSavings(model = HERO_BENCHMARK_MODEL): string {
  const floor = getHeroSavingsPercent(model);
  const rounded = Math.floor(floor / 5) * 5;
  return `${Math.max(0, rounded)}%+`;
}

export function getHeroSavingsHint(model = HERO_BENCHMARK_MODEL): string {
  const bench = getOpenAiBenchmark(model);
  return `vs ${bench.label} list price`;
}
