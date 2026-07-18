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

/** String for text-only messages, or an array of parts for multimodal (vision) input. */
export type ChatMessageContent = string | ChatContentPart[];

export interface ChatMessage {
  role: ChatRole;
  content: ChatMessageContent;
}

export interface ChatCompletionRequest {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  max_tokens?: number;
  max_completion_tokens?: number;
  stream?: boolean;
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
  if (typeof content === "string") return content;
  return content
    .filter((part): part is ChatTextPart => part.type === "text")
    .map((part) => part.text)
    .join("\n");
}

export function chatContentHasImage(content: ChatMessageContent): boolean {
  if (typeof content === "string") return false;
  return content.some((part) => part.type === "image_url");
}

export function chatMessagesHaveImageContent(messages: ChatMessage[]): boolean {
  return messages.some((message) => chatContentHasImage(message.content));
}
