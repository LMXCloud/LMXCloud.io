import { createSseModelState, observeSseModel } from "./sse-models.js";

export const WEATHER_TOOL = {
  type: "function" as const,
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
  role: "user" as const,
  content: "What is the weather in Paris right now? Call the get_weather tool.",
};

export const PLAIN_USER = {
  role: "user" as const,
  content: "Reply with the single word ok.",
};

export const JSON_USER = {
  role: "user" as const,
  content: "Return a JSON object with a greeting.",
};

export type ToolCall = {
  id?: string;
  type?: string;
  function?: { name?: string; arguments?: unknown };
};

export type StreamTermination = "done" | "closed" | "not_started" | "error" | "not_applicable";

export type ChatCapture = {
  httpStatus: number | null;
  provider: string | null;
  fallback: string | null;
  modelRequestedHeader: string | null;
  modelResolvedHeader: string | null;
  requestId: string | null;
  returnedModel: string | null;
  streamModelIds: string[];
  finishReason: string | null;
  streamTermination: StreamTermination;
  contentText: string;
  toolCalls: ToolCall[];
  usage: unknown;
  error: string | null;
  responseJson: unknown | null;
  sseFrames: string[] | null;
  clientLatencyMs: number;
};

const SECRET_KEYS = new Set([
  "authorization",
  "api_key",
  "apikey",
  "access_token",
  "password",
  "secret",
]);

export function forwardingApiUrl(): string {
  return (process.env.API_URL ?? "https://api.lmxcloud.io").replace(/\/$/, "");
}

export function forwardingTimeoutMs(): number {
  return Number(process.env.FORWARDING_TEST_TIMEOUT_MS ?? 120_000);
}

export function redact(text: string, secret: string): string {
  return secret ? text.split(secret).join("[redacted]") : text;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function sanitizeValue(value: unknown, secret: string): unknown {
  if (typeof value === "string") return redact(value, secret);
  if (Array.isArray(value)) return value.map((item) => sanitizeValue(item, secret));
  if (!isRecord(value)) return value;
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (SECRET_KEYS.has(key.toLowerCase())) continue;
    out[key] = sanitizeValue(child, secret);
  }
  return out;
}

/** One HTTP attempt. Callers must not retry a failure. */
export async function postChat(apiKey: string, body: Record<string, unknown>): Promise<ChatCapture> {
  const started = performance.now();
  const streaming = body.stream === true;
  let response: Response;
  try {
    response = await fetch(`${forwardingApiUrl()}/v1/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(forwardingTimeoutMs()),
    });
  } catch (err) {
    return failedCapture(err, streaming ? "error" : "error", Math.round(performance.now() - started));
  }

  const headers = readLmxHeaders(response);
  if (!response.ok) {
    const errorText = await response.text();
    const responseJson = parseBody(errorText);
    return {
      ...blankCapture(Math.round(performance.now() - started)),
      ...headers,
      httpStatus: response.status,
      requestId: headers.requestId ?? idFromBody(responseJson),
      streamTermination: streaming ? "not_started" : "not_applicable",
      error: errorMessage(errorText) ?? `HTTP ${response.status}`,
      responseJson,
      sseFrames: null,
    };
  }

  if (streaming) {
    const parsed = await readSse(response, started);
    return {
      ...parsed,
      ...headers,
      requestId: headers.requestId ?? parsed.requestId,
      httpStatus: response.status,
      clientLatencyMs: Math.round(performance.now() - started),
    };
  }

  const json = (await response.json()) as Record<string, unknown>;
  const choice = firstChoice(json);
  const message = isRecord(choice?.message) ? choice.message : undefined;
  const returnedModel = typeof json.model === "string" ? json.model : null;
  return {
    httpStatus: response.status,
    ...headers,
    requestId: headers.requestId ?? (typeof json.id === "string" ? json.id : null),
    returnedModel,
    streamModelIds: [],
    finishReason: typeof choice?.finish_reason === "string" ? choice.finish_reason : null,
    streamTermination: "not_applicable",
    contentText: textFromContent(message?.content),
    toolCalls: readToolCalls(message?.tool_calls),
    usage: json.usage ?? null,
    error: null,
    responseJson: json,
    sseFrames: null,
    clientLatencyMs: Math.round(performance.now() - started),
  };
}

export function failedCapture(
  err: unknown,
  streamTermination: StreamTermination = "error",
  clientLatencyMs = 0,
): ChatCapture {
  const message = err instanceof Error ? err.message : String(err);
  return {
    ...blankCapture(clientLatencyMs),
    streamTermination,
    error: clip(message),
  };
}

export async function readSse(
  response: Response,
  _started: number,
): Promise<
  Omit<
    ChatCapture,
    | "provider"
    | "fallback"
    | "modelRequestedHeader"
    | "modelResolvedHeader"
    | "clientLatencyMs"
  >
> {
  const reader = response.body?.getReader();
  if (!reader) {
    return {
      ...blankCapture(0),
      httpStatus: response.status,
      streamTermination: "error",
      error: "empty stream body",
    };
  }

  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
  }
  buffer += decoder.decode();
  return { ...parseSseText(buffer), httpStatus: response.status };
}

/**
 * Parse SSE text already split into frames.
 * `data: [DONE]` completes the stream. A later `event: lmx.meta` or `event: lmx.error`
 * is a gateway trailer and does not reopen it. Another completion chunk after `[DONE]` does.
 */
export function parseSseFrames(frames: readonly string[]): SseParse {
  return parseSseText(frames.join("\n\n"));
}

export type SseParse = {
  requestId: string | null;
  returnedModel: string | null;
  streamModelIds: string[];
  finishReason: string | null;
  streamTermination: StreamTermination;
  contentText: string;
  toolCalls: ToolCall[];
  usage: unknown;
  error: string | null;
  responseJson: null;
  sseFrames: string[];
};

export function parseSseText(text: string): SseParse {
  let finishReason: string | null = null;
  let usage: unknown = null;
  let contentText = "";
  let requestId: string | null = null;
  let error: string | null = null;
  let sawDone = false;
  let dataAfterDone = false;
  const sseModels = createSseModelState();
  const sseFrames: string[] = [];
  const slots = new Map<number, { id?: string; name: string; arguments: string; type?: string }>();

  const consume = (frame: string) => {
    if (frame.trim()) sseFrames.push(frame);
    const eventName = frame
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.startsWith("event:"))
      ?.slice("event:".length)
      .trim();
    const data = frame
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim())
      .find((line) => line.length > 0);
    if (!data) return;
    if (data === "[DONE]") {
      sawDone = true;
      return;
    }
    if (sawDone) {
      if (eventName === "lmx.meta" || eventName === "lmx.error") {
        if (eventName === "lmx.error") {
          let message = data;
          try {
            const parsed = JSON.parse(data) as unknown;
            if (isRecord(parsed) && typeof parsed.message === "string") message = parsed.message;
          } catch {
            /* keep the raw data */
          }
          error = clip(message);
        }
        return;
      }
      dataAfterDone = true;
      return;
    }
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(data) as Record<string, unknown>;
    } catch {
      return;
    }
    if (!requestId && typeof parsed.id === "string") requestId = parsed.id;
    if (parsed.usage && typeof parsed.usage === "object") usage = parsed.usage;
    if (isRecord(parsed.error) && typeof parsed.error.message === "string") {
      error = clip(parsed.error.message);
    }
    if (eventName === "lmx.error") {
      const message = typeof parsed.message === "string" ? parsed.message : data;
      error = clip(message);
    }
    observeSseModel(sseModels, parsed.model);
    const choice = firstChoice(parsed);
    if (!choice) return;
    if (typeof choice.finish_reason === "string") finishReason = choice.finish_reason;
    const delta = isRecord(choice.delta) ? choice.delta : isRecord(choice.message) ? choice.message : undefined;
    if (!delta) return;
    contentText += textFromContent(delta.content);
    absorbToolDeltas(slots, delta.tool_calls);
  };

  let buffer = text.replace(/\r\n/g, "\n");
  let boundary = buffer.indexOf("\n\n");
  while (boundary >= 0) {
    consume(buffer.slice(0, boundary));
    buffer = buffer.slice(boundary + 2);
    boundary = buffer.indexOf("\n\n");
  }
  if (buffer.trim()) consume(buffer);

  const toolCalls: ToolCall[] = [...slots.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, slot]) => ({
      id: slot.id,
      type: slot.type ?? "function",
      function: { name: slot.name, arguments: slot.arguments },
    }));

  return {
    requestId,
    returnedModel: sseModels.lastModel,
    streamModelIds: sseModels.models,
    finishReason,
    streamTermination: sawDone && !dataAfterDone ? "done" : "closed",
    contentText,
    toolCalls,
    usage,
    error,
    responseJson: null,
    sseFrames,
  };
}

function readLmxHeaders(response: Response): {
  provider: string | null;
  fallback: string | null;
  modelRequestedHeader: string | null;
  modelResolvedHeader: string | null;
  requestId: string | null;
} {
  return {
    provider: response.headers.get("x-lmx-provider"),
    fallback: response.headers.get("x-lmx-fallback"),
    modelRequestedHeader: response.headers.get("x-lmx-model-requested"),
    modelResolvedHeader: response.headers.get("x-lmx-model-resolved"),
    requestId: response.headers.get("x-request-id") ?? response.headers.get("x-lmx-request-id"),
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

function idFromBody(body: unknown): string | null {
  return isRecord(body) && typeof body.id === "string" ? body.id : null;
}

function clip(text: string): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length > 2000 ? `${oneLine.slice(0, 2000)}…` : oneLine;
}

function blankCapture(clientLatencyMs: number): ChatCapture {
  return {
    httpStatus: null,
    provider: null,
    fallback: null,
    modelRequestedHeader: null,
    modelResolvedHeader: null,
    requestId: null,
    returnedModel: null,
    streamModelIds: [],
    finishReason: null,
    streamTermination: "error",
    contentText: "",
    toolCalls: [],
    usage: null,
    error: null,
    responseJson: null,
    sseFrames: null,
    clientLatencyMs,
  };
}
