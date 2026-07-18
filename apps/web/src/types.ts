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

export interface UsageLogEntry {
  id: string;
  created_at: string;
  api_key_id: string;
  route: string;
  resource_type?: string;
  provider: string;
  model: string;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  cost: number;
  latency_ms: number;
  fallback_used: boolean;
  success?: boolean;
  status: number;
}

export interface UsageLogsResponse {
  object: string;
  days: number | null;
  data: UsageLogEntry[];
  has_more: boolean;
  next_cursor: string | null;
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
  email?: string;
  wallet?: string | null;
  api_key_id: string;
  created_account?: boolean;
}

export interface WalletLinkResponse {
  object: string;
  wallet: string;
  email: string | null;
  api_key_id: string;
  note: string;
}

export interface WalletNonceResponse {
  object: string;
  address: string;
  nonce: string;
  expires_at: string;
  chain_id: number;
  domain: string;
  uri: string;
}

export interface DepositInfoResponse {
  object: string;
  treasury_address: string;
  usdc_contract_address: string;
  chain: string;
  chain_id: number;
  token: string;
  confirmations_required: number;
  min_deposit_usdc: number;
  max_deposit_usdc: number;
  wallet: string;
  note: string;
}

export interface DepositReceipt {
  object: string;
  tx_hash: string;
  amount: number;
  currency: string;
  status: "pending" | "credited" | "unmatched";
  confirmations: number;
  created_at: string;
  credited_at: string | null;
}

export interface DepositHistoryResponse {
  object: string;
  chain: string;
  confirmations_required: number;
  data: DepositReceipt[];
}

export type PaymentEventStatus =
  | "quoted"
  | "verified"
  | "fulfilling"
  | "settled"
  | "completed"
  | "failed"
  | "refunded";

export interface PaymentRecord {
  object: "payment";
  id: string;
  usage_event_id: string | null;
  api_key_id: string | null;
  payer_wallet: string;
  quoted_amount: number;
  settled_amount: number | null;
  refunded_amount: number;
  chain_id: number;
  tx_hash: string | null;
  model: string;
  route: string;
  estimated_tokens: number | null;
  status: PaymentEventStatus;
  failure_reason: string | null;
  created_at: string;
  verified_at: string | null;
  settled_at: string | null;
  completed_at: string | null;
}

export interface PaymentsResponse {
  object: string;
  x402_enabled: boolean;
  days: number | null;
  data: PaymentRecord[];
  has_more: boolean;
  next_cursor: string | null;
}
