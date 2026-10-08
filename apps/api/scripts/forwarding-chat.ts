import { createSseModelState, observeSseModel } from "./sse-models.js";

export const WEATHER_TOOL = {
  type: "function",
  function: {
    name: "get_weather",
    description: "Get the current weather for a city",
    parameters: {
      type: "object",
      properties: { city: { type: "string" } },
      required: ["city"],
    },
  },
};

export const WEATHER_USER = {
  role: "user",
  content: "What is the weather in Paris right now? Call the get_weather tool.",
};

export type ToolCall = {
  id?: string;
  type?: string;
  function?: { name?: string; arguments?: unknown };
};

export type ChatResult = {
  httpStatus: number | null;
  provider: string | null;
  fallback: string | null;
  latencyHeader: string | null;
  costHeader: string | null;
  returnedModel: string | null;
  /** Distinct top-level `model` strings in first-seen order. Streaming only collects these across chunks. */
  modelsSeen: string[];
  finishReason: string | null;
  contentText: string;
  toolCalls: ToolCall[];
  usage: unknown;
  clientLatencyMs: number;
  ttftMs: number | null;
  errorMessage: string | null;
  /** Parsed JSON body, or the raw text when the non-stream body is not JSON. Null for streams. */
  responseBody: unknown | null;
  /** SSE event frames after CRLF normalization. Null for non-stream responses. */
  sseFrames: string[] | null;
};

export function forwardingApiUrl(): string {
  return (process.env.API_URL ?? "https://api.lmxcloud.io").replace(/\/$/, "");
}

export function forwardingTimeoutMs(): number {
  return Number(process.env.FORWARDING_TEST_TIMEOUT_MS ?? 120_000);
}

export async function postChat(
  apiKey: string,
  body: Record<string, unknown>,
  prefer?: string,
): Promise<ChatResult> {
  const started = performance.now();
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
  if (prefer) headers["x-lmx-prefer"] = `provider:${prefer}`;

  let response: Response;
  try {
    response = await fetch(`${forwardingApiUrl()}/v1/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(forwardingTimeoutMs()),
    });
  } catch (err) {
    return failedChat(Math.round(performance.now() - started), err);
  }

  const provider = response.headers.get("x-lmx-provider");
  const fallback = response.headers.get("x-lmx-fallback");
  const latencyHeader = response.headers.get("x-lmx-latency");
  const costHeader = response.headers.get("x-lmx-cost");
  const streaming = body.stream === true;

  if (!response.ok) {
    const errorText = await response.text();
    return {
      ...blankChat(Math.round(performance.now() - started)),
      httpStatus: response.status,
      provider,
      fallback,
      latencyHeader,
      costHeader,
      errorMessage: errorMessage(errorText) ?? `HTTP ${response.status}`,
      responseBody: parseBody(errorText),
    };
  }

  if (streaming) {
    const parsed = await readSse(response, started);
    return {
      ...parsed,
      provider,
      fallback,
      latencyHeader,
      costHeader,
      clientLatencyMs: Math.round(performance.now() - started),
    };
  }

  const json = (await response.json()) as Record<string, unknown>;
  const choice = firstChoice(json);
  const message = isRecord(choice?.message) ? choice.message : undefined;
  const toolCalls = readToolCalls(message?.tool_calls);
  const contentText = textFromContent(message?.content);
  const returnedModel = typeof json.model === "string" ? json.model : null;
  return {
    httpStatus: response.status,
    provider,
    fallback,
    latencyHeader,
    costHeader,
    returnedModel,
    modelsSeen: returnedModel ? [returnedModel] : [],
    finishReason: typeof choice?.finish_reason === "string" ? choice.finish_reason : null,
    contentText,
    toolCalls,
    usage: json.usage ?? null,
    clientLatencyMs: Math.round(performance.now() - started),
    ttftMs: null,
    errorMessage: null,
    responseBody: json,
    sseFrames: null,
  };
}

export function failedChat(clientLatencyMs: number, err: unknown): ChatResult {
  const message = err instanceof Error ? err.message : String(err);
  return { ...blankChat(clientLatencyMs), errorMessage: clip(message) };
}

export function redact(text: string, secret: string): string {
  return secret ? text.split(secret).join("[redacted]") : text;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function readSse(
  response: Response,
  started: number,
): Promise<
  Omit<ChatResult, "provider" | "fallback" | "latencyHeader" | "costHeader" | "clientLatencyMs">
> {
  const reader = response.body?.getReader();
  if (!reader) {
    return {
      ...blankChat(0),
      httpStatus: response.status,
      errorMessage: "empty stream body",
    };
  }
  const decoder = new TextDecoder();
  let buffer = "";
  let ttftMs: number | null = null;
  let finishReason: string | null = null;
  let usage: unknown = null;
  let contentText = "";
  const sseModels = createSseModelState();
  const sseFrames: string[] = [];
  const slots = new Map<number, { id?: string; name: string; arguments: string; type?: string }>();

  const consume = (frame: string) => {
    if (frame.trim()) sseFrames.push(frame);
    const data = frame
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim())
      .find((line) => line.length > 0);
    if (!data || data === "[DONE]") return;
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(data) as Record<string, unknown>;
    } catch {
      return;
    }
    if (parsed.usage && typeof parsed.usage === "object") usage = parsed.usage;
    // lastModel keeps the previous single-value behavior; models keeps every distinct id.
    observeSseModel(sseModels, parsed.model);
    const choice = firstChoice(parsed);
    if (!choice) return;
    if (typeof choice.finish_reason === "string") finishReason = choice.finish_reason;
    const delta = isRecord(choice.delta) ? choice.delta : isRecord(choice.message) ? choice.message : undefined;
    if (!delta) return;
    if (ttftMs === null && (delta.content != null || delta.tool_calls != null || delta.role != null)) {
      ttftMs = Math.round(performance.now() - started);
    }
    contentText += textFromContent(delta.content);
    absorbToolDeltas(slots, delta.tool_calls);
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
    let boundary = buffer.indexOf("\n\n");
    while (boundary >= 0) {
      consume(buffer.slice(0, boundary));
      buffer = buffer.slice(boundary + 2);
      boundary = buffer.indexOf("\n\n");
    }
  }
  buffer += decoder.decode();
  if (buffer.trim()) consume(buffer);

  const toolCalls: ToolCall[] = [...slots.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, slot]) => ({
      id: slot.id,
      type: slot.type ?? "function",
      function: { name: slot.name, arguments: slot.arguments },
    }));

  return {
    httpStatus: response.status,
    returnedModel: sseModels.lastModel,
    modelsSeen: sseModels.models,
    finishReason,
    contentText,
    toolCalls,
    usage,
    ttftMs,
    errorMessage: null,
    responseBody: null,
    sseFrames,
  };
}

function absorbToolDeltas(
  slots: Map<number, { id?: string; name: string; arguments: string; type?: string }>,
  value: unknown,
) {
  if (!Array.isArray(value)) return;
  for (const raw of value) {
    if (!isRecord(raw)) continue;
    const index = typeof raw.index === "number" ? raw.index : 0;
    const slot = slots.get(index) ?? { name: "", arguments: "" };
    if (typeof raw.id === "string" && raw.id) slot.id = raw.id;
    if (typeof raw.type === "string" && raw.type) slot.type = raw.type;
    const fn = isRecord(raw.function) ? raw.function : undefined;
    if (typeof fn?.name === "string") slot.name += fn.name;
    if (typeof fn?.arguments === "string") slot.arguments += fn.arguments;
    slots.set(index, slot);
  }
}

function firstChoice(body: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!body || !Array.isArray(body.choices)) return undefined;
  const choice = body.choices[0];
  return isRecord(choice) ? choice : undefined;
}

function readToolCalls(value: unknown): ToolCall[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord) as ToolCall[];
}

function textFromContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => (isRecord(part) && typeof part.text === "string" ? part.text : ""))
    .join("");
}

function errorMessage(text: string): string | null {
  try {
    const json = JSON.parse(text) as { error?: { message?: string }; message?: string };
    const message = json.error?.message ?? json.message;
    if (typeof message === "string" && message.trim()) return clip(message);
  } catch {
    /* plain text */
  }
  const trimmed = text.trim();
  return trimmed ? clip(trimmed) : null;
}

function parseBody(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function clip(text: string): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length > 240 ? `${oneLine.slice(0, 240)}…` : oneLine;
}

function blankChat(clientLatencyMs: number): ChatResult {
  return {
    httpStatus: null,
    provider: null,
    fallback: null,
    latencyHeader: null,
    costHeader: null,
    returnedModel: null,
    modelsSeen: [],
    finishReason: null,
    contentText: "",
    toolCalls: [],
    usage: null,
    clientLatencyMs,
    ttftMs: null,
    errorMessage: null,
    responseBody: null,
    sseFrames: null,
  };
}
