import {
  isThinkingOffByDefault,
  type ChatCompletionMessageToolCall,
  type ChatCompletionRequest,
  type ChatMessage,
  type ChatResponseFormat,
  type ChatStreamOptions,
  type ChatTemplateKwargs,
  type ChatTool,
  type ChatToolChoice,
  type JsonObject,
  type JsonValue,
  type ReasoningEffort,
} from "@lmxcloud/shared";

/**
 * Request fields copied onto the upstream chat body when the caller sets them.
 * Anything else on the incoming JSON is ignored.
 */
export const FORWARDED_CHAT_FIELDS = [
  "tools",
  "tool_choice",
  "response_format",
  "reasoning_effort",
  "chat_template_kwargs",
  "top_p",
  "stop",
  "seed",
  "stream_options",
] as const;

export type ForwardedChatField = (typeof FORWARDED_CHAT_FIELDS)[number];

/**
 * Fields dropped for one provider because that provider rejects them.
 * Every other provider still receives the field.
 *
 * Live 2026-10-04: Akash accepted this allowlist, and Aethir accepted
 * chat_template_kwargs on qwen-3.6-35b. io.net's published schema allows
 * additional properties and documents the same body. Add a provider here
 * only after it returns HTTP 400 for that field.
 */
export const PROVIDER_REJECTED_FIELDS: Readonly<
  Record<string, readonly ForwardedChatField[]>
> = {};

const REASONING_EFFORTS = new Set<ReasoningEffort>([
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
]);

const TOOL_CHOICES = new Set(["none", "auto", "required"]);

export type ChatPassthrough = Pick<ChatCompletionRequest, ForwardedChatField>;

/**
 * Hybrid-thinking models spend max_tokens on reasoning unless thinking is off.
 * When the caller did not set reasoning_effort or enable_thinking, send
 * enable_thinking: false. Anything they set is returned unchanged.
 */
export function withThinkingDefault(
  request: Pick<ChatCompletionRequest, "model" | "reasoning_effort" | "chat_template_kwargs">,
  upstreamModel?: string,
): ChatTemplateKwargs | undefined {
  const explicit = request.chat_template_kwargs;
  if (request.reasoning_effort !== undefined) return explicit;
  if (explicit !== undefined && Object.prototype.hasOwnProperty.call(explicit, "enable_thinking")) {
    return explicit;
  }
  const applies =
    isThinkingOffByDefault(request.model) ||
    (upstreamModel !== undefined && isThinkingOffByDefault(upstreamModel));
  if (!applies) return explicit;
  return { ...explicit, enable_thinking: false };
}

export function applyProviderFieldPolicy(
  provider: string,
  body: Record<string, unknown>,
): void {
  const rejected = PROVIDER_REJECTED_FIELDS[provider];
  if (!rejected) return;
  for (const field of rejected) {
    delete body[field];
  }
}

export function parseChatPassthrough(
  body: Record<string, unknown>,
): ChatPassthrough | string {
  const parsed: ChatPassthrough = {};

  if (body.tools !== undefined) {
    const tools = parseTools(body.tools);
    if (typeof tools === "string") return tools;
    parsed.tools = tools;
  }

  if (body.tool_choice !== undefined) {
    const toolChoice = parseToolChoice(body.tool_choice);
    if ("error" in toolChoice) return toolChoice.error;
    parsed.tool_choice = toolChoice.value;
  }

  if (body.response_format !== undefined) {
    const responseFormat = parseResponseFormat(body.response_format);
    if (typeof responseFormat === "string") return responseFormat;
    parsed.response_format = responseFormat;
  }

  if (body.reasoning_effort !== undefined) {
    if (!isReasoningEffort(body.reasoning_effort)) {
      return "Field 'reasoning_effort' must be one of: none, minimal, low, medium, high, xhigh, max";
    }
    parsed.reasoning_effort = body.reasoning_effort;
  }

  if (body.chat_template_kwargs !== undefined) {
    const kwargs = parseChatTemplateKwargs(body.chat_template_kwargs);
    if (typeof kwargs === "string") return kwargs;
    parsed.chat_template_kwargs = kwargs;
  }

  if (body.top_p !== undefined) {
    if (typeof body.top_p !== "number" || !Number.isFinite(body.top_p)) {
      return "Field 'top_p' must be a finite number";
    }
    parsed.top_p = body.top_p;
  }

  if (body.stop !== undefined) {
    const stop = parseStop(body.stop);
    if ("error" in stop) return stop.error;
    parsed.stop = stop.value;
  }

  if (body.seed !== undefined) {
    if (typeof body.seed !== "number" || !Number.isInteger(body.seed)) {
      return "Field 'seed' must be an integer";
    }
    parsed.seed = body.seed;
  }

  if (body.stream_options !== undefined) {
    const streamOptions = parseStreamOptions(body.stream_options);
    if (typeof streamOptions === "string") return streamOptions;
    // Unknown keys are stripped. An empty remainder is the same as omitting the field.
    if (streamOptions) parsed.stream_options = streamOptions;
  }

  return parsed;
}

/** Tool-calling fields stored on a message. Unknown message keys are not copied. */
export function readMessageToolFields(
  message: Record<string, unknown>,
): Pick<ChatMessage, "name" | "tool_call_id" | "tool_calls"> | string {
  const extras: Pick<ChatMessage, "name" | "tool_call_id" | "tool_calls"> = {};

  if (message.name !== undefined) {
    if (typeof message.name !== "string" || message.name.trim() === "") {
      return "Message 'name' must be a non-empty string";
    }
    extras.name = message.name;
  }

  if (message.tool_call_id !== undefined) {
    if (typeof message.tool_call_id !== "string" || message.tool_call_id.trim() === "") {
      return "Message 'tool_call_id' must be a non-empty string";
    }
    extras.tool_call_id = message.tool_call_id;
  }

  if (message.tool_calls !== undefined) {
    const toolCalls = parseMessageToolCalls(message.tool_calls);
    if (typeof toolCalls === "string") return toolCalls;
    extras.tool_calls = toolCalls;
  }

  return extras;
}

/**
 * Put provider tool_calls into the OpenAI shape.
 * Content that is already a string or null is left untouched.
 * A payload that is already in the standard shape is returned as the same object.
 */
export function normalizeChatCompletionPayload<T>(payload: T): T {
  if (!isPlainObject(payload) || !Array.isArray(payload.choices)) return payload;

  let changed = false;
  const choices = payload.choices.map((choice) => {
    const next = normalizeChoice(choice);
    if (next !== choice) changed = true;
    return next;
  });

  if (!changed) return payload;
  return { ...payload, choices } as T;
}

function normalizeChoice(choice: unknown): unknown {
  if (!isPlainObject(choice)) return choice;

  const message = isPlainObject(choice.message) ? choice.message : undefined;
  const delta = isPlainObject(choice.delta) ? choice.delta : undefined;
  const kind = message ? "message" : delta ? "delta" : null;
  const carrier = message ?? delta;
  if (!kind || !carrier || !Array.isArray(carrier.tool_calls)) return choice;

  let callsChanged = false;
  const toolCalls = carrier.tool_calls.map((call, index) => {
    const next = normalizeToolCall(call, index, kind);
    if (next !== call) callsChanged = true;
    return next;
  });

  const finishReason = nextFinishReason(choice.finish_reason, kind, toolCalls.length > 0);
  const finishChanged = finishReason !== choice.finish_reason;
  if (!callsChanged && !finishChanged) return choice;

  const nextCarrier = callsChanged
    ? { ...carrier, tool_calls: toolCalls }
    : carrier;

  return {
    ...choice,
    ...(finishChanged ? { finish_reason: finishReason } : {}),
    ...(message ? { message: nextCarrier } : { delta: nextCarrier }),
  };
}

function nextFinishReason(
  finish: unknown,
  kind: "message" | "delta",
  hasToolCalls: boolean,
): unknown {
  if (!hasToolCalls) return finish;
  if (finish === "tool_calls") return finish;
  if (finish === "stop" || finish === "function_call") return "tool_calls";
  // A full message with tool calls and no finish reason is a tool call.
  // Streaming deltas use null while tokens are still arriving.
  if (kind === "message" && (finish === null || finish === undefined)) {
    return "tool_calls";
  }
  return finish;
}

function normalizeToolCall(
  raw: unknown,
  position: number,
  kind: "message" | "delta",
): unknown {
  if (!isPlainObject(raw)) return raw;
  if (raw.type !== undefined && raw.type !== "function") return raw;

  const fn = isPlainObject(raw.function) ? raw.function : undefined;
  const index = typeof raw.index === "number" ? raw.index : undefined;

  // Streaming continuations are identified by index. Don't invent an id.
  if (kind === "delta" && index !== undefined) {
    if (!fn || !("arguments" in fn) || typeof fn.arguments === "string") return raw;
    const coerced = coerceArguments(fn.arguments);
    if (typeof coerced !== "string") return raw;
    return { ...raw, function: { ...fn, arguments: coerced } };
  }

  if (!fn || typeof fn.name !== "string" || fn.name.trim() === "") return raw;

  const args = coerceArguments(fn.arguments);
  const argumentsText = typeof args === "string" ? args : "";
  const id = typeof raw.id === "string" && raw.id.trim() !== "" ? raw.id : undefined;
  const already =
    id !== undefined &&
    raw.type === "function" &&
    typeof fn.arguments === "string";
  if (already) return raw;

  const toolCall: ChatCompletionMessageToolCall & { index?: number } = {
    ...(index !== undefined ? { index } : {}),
    id: id ?? `call_${position}`,
    type: "function",
    function: {
      name: fn.name,
      arguments: argumentsText,
    },
  };
  return toolCall;
}

function coerceArguments(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (value === undefined) return undefined;
  if (value === null) return "";
  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    Array.isArray(value) ||
    isPlainObject(value)
  ) {
    return JSON.stringify(value);
  }
  return undefined;
}

function parseTools(value: unknown): ChatTool[] | string {
  if (!Array.isArray(value)) return "Field 'tools' must be an array";
  const tools: ChatTool[] = [];
  for (let i = 0; i < value.length; i++) {
    const tool = parseTool(value[i], i);
    if (typeof tool === "string") return tool;
    tools.push(tool);
  }
  return tools;
}

function parseTool(value: unknown, index: number): ChatTool | string {
  if (!isPlainObject(value)) return `tools[${index}] must be an object`;
  if (value.type !== "function") {
    return `tools[${index}].type must be "function"`;
  }
  if (!isPlainObject(value.function)) {
    return `tools[${index}].function must be an object`;
  }
  const fn = value.function;
  if (typeof fn.name !== "string" || fn.name.trim() === "") {
    return `tools[${index}].function.name must be a non-empty string`;
  }
  const tool: ChatTool = {
    type: "function",
    function: { name: fn.name },
  };
  if (fn.description !== undefined) {
    if (typeof fn.description !== "string") {
      return `tools[${index}].function.description must be a string`;
    }
    tool.function.description = fn.description;
  }
  if (fn.parameters !== undefined) {
    if (!isPlainObject(fn.parameters)) {
      return `tools[${index}].function.parameters must be an object`;
    }
    tool.function.parameters = fn.parameters as JsonObject;
  }
  if (fn.strict !== undefined) {
    if (typeof fn.strict !== "boolean") {
      return `tools[${index}].function.strict must be a boolean`;
    }
    tool.function.strict = fn.strict;
  }
  return tool;
}

function parseToolChoice(
  value: unknown,
): { value: ChatToolChoice } | { error: string } {
  if (typeof value === "string") {
    if (!TOOL_CHOICES.has(value)) {
      return {
        error: "Field 'tool_choice' must be none, auto, required, or a named function",
      };
    }
    return { value: value as ChatToolChoice };
  }
  if (!isPlainObject(value) || value.type !== "function" || !isPlainObject(value.function)) {
    return {
      error: "Field 'tool_choice' must be none, auto, required, or a named function",
    };
  }
  if (typeof value.function.name !== "string" || value.function.name.trim() === "") {
    return { error: "tool_choice.function.name must be a non-empty string" };
  }
  return {
    value: {
      type: "function",
      function: { name: value.function.name },
    },
  };
}

function parseResponseFormat(value: unknown): ChatResponseFormat | string {
  if (!isPlainObject(value) || typeof value.type !== "string") {
    return "Field 'response_format' must be an object with type json_object, json_schema, or text";
  }
  if (value.type === "json_object" || value.type === "text") {
    return { type: value.type };
  }
  if (value.type !== "json_schema") {
    return "Field 'response_format.type' must be json_object, json_schema, or text";
  }
  if (!isPlainObject(value.json_schema)) {
    return "response_format.json_schema must be an object";
  }
  const schema = value.json_schema;
  if (typeof schema.name !== "string" || schema.name.trim() === "") {
    return "response_format.json_schema.name must be a non-empty string";
  }
  const jsonSchema: {
    name: string;
    description?: string;
    schema?: JsonObject;
    strict?: boolean;
  } = {
    name: schema.name,
  };
  if (schema.description !== undefined) {
    if (typeof schema.description !== "string") {
      return "response_format.json_schema.description must be a string";
    }
    jsonSchema.description = schema.description;
  }
  if (schema.strict !== undefined) {
    if (typeof schema.strict !== "boolean") {
      return "response_format.json_schema.strict must be a boolean";
    }
    jsonSchema.strict = schema.strict;
  }
  if (schema.schema !== undefined) {
    if (!isPlainObject(schema.schema)) {
      return "response_format.json_schema.schema must be an object";
    }
    jsonSchema.schema = schema.schema as JsonObject;
  }
  return { type: "json_schema", json_schema: jsonSchema };
}

function parseChatTemplateKwargs(value: unknown): ChatTemplateKwargs | string {
  if (!isPlainObject(value)) {
    return "Field 'chat_template_kwargs' must be an object";
  }
  const kwargs: ChatTemplateKwargs = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!isJsonValue(entry)) {
      return `chat_template_kwargs.${key} must be JSON`;
    }
    kwargs[key] = entry;
  }
  return kwargs;
}

function parseStop(
  value: unknown,
): { value: string | string[] } | { error: string } {
  if (typeof value === "string") return { value };
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    return { error: "Field 'stop' must be a string or an array of strings" };
  }
  return { value };
}

function parseStreamOptions(value: unknown): ChatStreamOptions | undefined | string {
  if (!isPlainObject(value)) return "Field 'stream_options' must be an object";
  const options: ChatStreamOptions = {};
  if (value.include_usage !== undefined) {
    if (typeof value.include_usage !== "boolean") {
      return "stream_options.include_usage must be a boolean";
    }
    options.include_usage = value.include_usage;
  }
  if (value.continuous_usage_stats !== undefined) {
    if (typeof value.continuous_usage_stats !== "boolean") {
      return "stream_options.continuous_usage_stats must be a boolean";
    }
    options.continuous_usage_stats = value.continuous_usage_stats;
  }
  return Object.keys(options).length > 0 ? options : undefined;
}

function parseMessageToolCalls(
  value: unknown,
): ChatCompletionMessageToolCall[] | string {
  if (!Array.isArray(value)) return "Message 'tool_calls' must be an array";
  const calls: ChatCompletionMessageToolCall[] = [];
  for (let i = 0; i < value.length; i++) {
    const normalized = normalizeToolCall(value[i], i, "message");
    if (
      !isPlainObject(normalized) ||
      normalized.type !== "function" ||
      !isPlainObject(normalized.function) ||
      typeof normalized.function.name !== "string" ||
      typeof normalized.id !== "string"
    ) {
      return `messages tool_calls[${i}] must be a function tool call`;
    }
    calls.push({
      id: normalized.id,
      type: "function",
      function: {
        name: normalized.function.name,
        arguments:
          typeof normalized.function.arguments === "string"
            ? normalized.function.arguments
            : "",
      },
    });
  }
  return calls;
}

function isReasoningEffort(value: unknown): value is ReasoningEffort {
  return typeof value === "string" && REASONING_EFFORTS.has(value as ReasoningEffort);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null) return true;
  if (typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  if (!isPlainObject(value)) return false;
  return Object.values(value).every(isJsonValue);
}
