import { expectedProviderModelId } from "../src/providers/model-maps.js";

export type FollowupBlock = "A" | "B" | "C" | "D";

export type ToolCallLike = {
  function?: { name?: string; arguments?: unknown };
};

export type ToolEvidence = {
  tool_call_name: string | null;
  tool_arguments_json: boolean;
  tool_arguments_has_city: boolean;
  tool_ok: boolean;
  tool_reason: string;
};

export type FollowupJudgeInput = {
  block: FollowupBlock;
  preferredProvider: string;
  requestedModel: string;
  httpStatus: number | null;
  provider: string | null;
  fallback: string | null;
  finishReason: string | null;
  models: readonly string[];
  errorMessage: string | null;
  tool: ToolEvidence;
};

export type FollowupJudge = {
  verdict: string;
  reason: string;
  akash_path: boolean;
  mismatch: boolean;
  tool_pass: boolean;
  expected_model: string | null;
  tags: string[];
};

const TOOL_BLOCKS = new Set<FollowupBlock>(["B", "C"]);

export function describeToolCalls(calls: readonly ToolCallLike[]): ToolEvidence {
  if (calls.length === 0) {
    return {
      tool_call_name: null,
      tool_arguments_json: false,
      tool_arguments_has_city: false,
      tool_ok: false,
      tool_reason: "no tool call",
    };
  }

  const names = calls.map((call) => call.function?.name ?? "");
  const parsed = calls.map((call) => parseArguments(call.function?.arguments));
  const tool_arguments_json = parsed.every((value) => value.parsed);
  const tool_arguments_has_city = parsed.every((value) => value.hasCity);
  const namesOk = names.every((name) => name === "get_weather");
  let tool_reason = "get_weather arguments included a city";
  if (!namesOk) tool_reason = `function name ${names.filter(Boolean).join(",") || "missing"}`;
  else if (!tool_arguments_json) tool_reason = "arguments did not parse as JSON";
  else if (!tool_arguments_has_city) tool_reason = "arguments JSON had no city";

  return {
    tool_call_name: names.join(","),
    tool_arguments_json,
    tool_arguments_has_city,
    tool_ok: namesOk && tool_arguments_json && tool_arguments_has_city,
    tool_reason,
  };
}

export function judgeQwenFollowup(input: FollowupJudgeInput): FollowupJudge {
  const tags: string[] = [];
  const reasons: string[] = [];
  const provider = input.provider;
  if (provider?.toLowerCase() === "aethir") tags.push("aethir");

  const httpOk =
    input.httpStatus != null &&
    input.httpStatus >= 200 &&
    input.httpStatus < 300 &&
    !input.errorMessage;
  if (!httpOk) {
    tags.push("fail");
    reasons.push(input.errorMessage ?? `HTTP ${input.httpStatus ?? "missing"}`);
  }

  const noFallback = input.fallback?.toLowerCase() === "false";
  const onPath = provider === input.preferredProvider && noFallback;
  if (!onPath && input.httpStatus != null) {
    tags.push("fallback");
    if (provider !== input.preferredProvider) {
      reasons.push(`provider ${provider ?? "missing"} preferred ${input.preferredProvider}`);
    }
    if (!noFallback) reasons.push(`x-lmx-fallback ${input.fallback ?? "missing"}`);
  }

  const expected = provider ? expectedProviderModelId(provider, input.requestedModel) ?? null : null;
  let mismatch = false;
  if (httpOk) {
    if (!provider || !expected) {
      mismatch = true;
      reasons.push(provider ? `no expected upstream id for ${provider}` : "provider header missing");
    } else if (input.models.length === 0) {
      mismatch = true;
      reasons.push(`no model value; expected ${expected}`);
    } else {
      const differing = input.models.filter((model) => model !== expected);
      if (differing.length > 0) {
        mismatch = true;
        reasons.push(`expected ${expected}; saw ${input.models.join(" | ")}`);
      }
    }
  }
  if (mismatch) tags.push("mismatch");

  const toolBlock = TOOL_BLOCKS.has(input.block);
  const toolPass = toolBlock && httpOk && input.finishReason === "tool_calls" && input.tool.tool_ok;
  if (toolBlock && httpOk && !toolPass) {
    tags.push("tool_fail");
    if (input.finishReason !== "tool_calls") {
      reasons.push(`finish_reason ${input.finishReason ?? "missing"}`);
    }
    if (!input.tool.tool_ok) reasons.push(input.tool.tool_reason);
  }

  const verdict = tags.length === 0 ? "pass" : tags.join("+");
  if (verdict === "pass") {
    reasons.push(toolBlock ? "on path, model matched, tool call parsed" : "on path, model matched");
  }

  return {
    verdict,
    reason: reasons.join("; "),
    akash_path: provider === "akash" && noFallback,
    mismatch,
    tool_pass: toolPass,
    expected_model: expected,
    tags,
  };
}

function parseArguments(value: unknown): { parsed: boolean; hasCity: boolean } {
  if (typeof value !== "string") return { parsed: false, hasCity: false };
  try {
    const json = JSON.parse(value) as unknown;
    const hasCity = isRecord(json) && typeof json.city === "string" && json.city.trim().length > 0;
    return { parsed: true, hasCity };
  } catch {
    return { parsed: false, hasCity: false };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
