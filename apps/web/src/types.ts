export interface ApiError {
  error: { message: string; type: string; code?: string };
}

export interface KeyUsage {
  requests: number;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  last_request_at: string | null;
}

export interface ApiKeyInfo {
  object: string;
  id: string;
  email: string | null;
  wallet: string | null;
  created_at: string;
  last_used_at: string | null;
  balance: number;
  currency: string;
  is_current: boolean;
  usage: KeyUsage;
}

export interface KeysResponse {
  object: string;
  data: ApiKeyInfo[];
}

export interface UsageResponse {
  object: string;
  api_key_id: string;
  requests: number;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  last_request_at: string | null;
}

export interface UsageHistoryBucket {
  date: string;
  requests: number;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  cost: number;
}

export interface UsageHistoryResponse {
  object: string;
  days: number;
  data: UsageHistoryBucket[];
}

export interface BalanceResponse {
  object: string;
  api_key_id: string;
  balance: number;
  currency: string;
  credited?: number;
}

export interface CreateKeyResponse {
  object: string;
  api_key: string;
  id: string;
  email: string | null;
  wallet: string | null;
  created_at: string;
  balance: number;
  currency: string;
}

export interface LoginResponse {
  object: string;
  session_token: string;
  email: string;
  api_key_id: string;
}
