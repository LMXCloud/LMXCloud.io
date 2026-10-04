export type ChatRole = "system" | "user" | "assistant" | "tool";

/** OpenAI-compatible text content part. */
export interface ChatTextPart {
  type: "text";
  text: string;
}

/** OpenAI-compatible image content part (URL or data:image/...;base64,...). */
export interface ChatImageUrlPart {
  type: "image_url";
  image_url: {
    url: string;
    detail?: "auto" | "low" | "high";
  };
}

export type ChatContentPart = ChatTextPart | ChatImageUrlPart;

/** String for text-only messages, an array of parts for vision input, or null for tool-only assistant messages. */
export type ChatMessageContent = string | ChatContentPart[] | null;

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export type JsonObject = { [key: string]: JsonValue };

/** OpenAI function tool definition. */
export interface ChatToolFunction {
  name: string;
  description?: string;
  parameters?: JsonObject;
  strict?: boolean;
}

export interface ChatTool {
  type: "function";
  function: ChatToolFunction;
}

export type ChatToolChoice =
  | "none"
  | "auto"
  | "required"
  | {
      type: "function";
      function: { name: string };
    };

export interface ChatResponseFormatText {
  type: "text";
}

export interface ChatResponseFormatJsonObject {
  type: "json_object";
}

export interface ChatResponseFormatJsonSchema {
  type: "json_schema";
  json_schema: {
    name: string;
    description?: string;
    schema?: JsonObject;
    strict?: boolean;
  };
}

export type ChatResponseFormat =
  | ChatResponseFormatText
  | ChatResponseFormatJsonObject
  | ChatResponseFormatJsonSchema;

/** Values accepted by OpenAI-compatible reasoning models (o-series, gpt-oss, DeepSeek). */
export type ReasoningEffort =
  | "none"
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "max";

/** Provider chat-template controls, e.g. `{ enable_thinking: false }` for Qwen on vLLM. */
export type ChatTemplateKwargs = Record<string, JsonValue>;

export interface ChatStreamOptions {
  include_usage?: boolean;
  continuous_usage_stats?: boolean;
}

export interface ChatCompletionMessageToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

export interface ChatMessage {
  role: ChatRole;
  content: ChatMessageContent;
  name?: string;
  /** Required by OpenAI on `role: "tool"` messages. */
  tool_call_id?: string;
  tool_calls?: ChatCompletionMessageToolCall[];
}

export interface ChatCompletionRequest {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  max_tokens?: number;
  max_completion_tokens?: number;
  stream?: boolean;
  tools?: ChatTool[];
  tool_choice?: ChatToolChoice;
  response_format?: ChatResponseFormat;
  reasoning_effort?: ReasoningEffort;
  chat_template_kwargs?: ChatTemplateKwargs;
  top_p?: number;
  stop?: string | string[];
  seed?: number;
  stream_options?: ChatStreamOptions;
}

export interface ChatCompletionChoice {
  index: number;
  message: ChatMessage;
  finish_reason: string | null;
}

export interface UsageInfo {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface ChatCompletionResponse {
  id: string;
  object: "chat.completion";
  created: number;
  model: string;
  choices: ChatCompletionChoice[];
  usage?: UsageInfo;
}

export interface ModelInfo {
  id: string;
  object: "model";
  created: number;
  owned_by: string;
}

export interface ModelsResponse {
  object: "list";
  data: ModelInfo[];
}

export interface ErrorResponse {
  error: {
    message: string;
    type: string;
    code?: string;
  };
}

/** Flatten message content to plain text (ignores image parts). */
export function textFromChatContent(content: ChatMessageContent): string {
  if (content == null || typeof content === "string") return content ?? "";
  return content
    .filter((part): part is ChatTextPart => part.type === "text")
    .map((part) => part.text)
    .join("\n");
}

export function chatContentHasImage(content: ChatMessageContent): boolean {
  if (content == null || typeof content === "string") return false;
  return content.some((part) => part.type === "image_url");
}

export function chatMessagesHaveImageContent(messages: ChatMessage[]): boolean {
  return messages.some((message) => chatContentHasImage(message.content));
}
