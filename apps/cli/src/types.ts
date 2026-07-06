export interface UsageResponse {
  object: string;
  api_key_id: string;
  requests: number;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  last_request_at: string | null;
}

export interface BalanceResponse {
  object: string;
  api_key_id: string;
  balance: number;
  currency: string;
}

export interface LoginResponse {
  object: string;
  session_token: string;
  email: string;
  api_key_id: string;
}

export type AuthMode = "demo" | "account" | "env";

export interface CliAuth {
  mode: AuthMode;
  token: string;
  email?: string;
  label: string;
}
