export type OpsChannel = "x402" | "balance" | "mcp";

export type OpsProviderStatus = {
  healthy: boolean;
  latencyMs: number | null;
  tier: number;
  isDepin: boolean;
  lastCheck: number | null;
  statusCode?: number;
  errorDetail?: string;
  checkUrl?: string;
};

export type OpsPayment = {
  id: string;
  payerWallet: string;
  quotedAmount: number;
  settledAmount: number | null;
  status: string;
  model: string;
  route: string;
  chainId: number;
  txHash: string | null;
  createdAt: string;
  channel: "x402";
};

export type OpsPaymentDetail = OpsPayment & {
  object: "ops_payment";
  usageEventId: string | null;
  apiKeyId: string | null;
  refundedAmount: number;
  paymentPayloadHash: string;
  facilitatorRef: string | null;
  estimatedTokens: number | null;
  failureReason: string | null;
  verifiedAt: string | null;
  settledAt: string | null;
  completedAt: string | null;
};

export type OpsUsageDetail = {
  object: "ops_usage";
  id: string;
  channel: OpsChannel;
  provider: string;
  model: string;
  resourceType: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cost: number;
  latencyMs: number;
  fallbackUsed: boolean;
  success: boolean;
  errorCode: string | null;
  unitPrice: number | null;
  payerWallet: string | null;
  apiKeyId: string | null;
  paymentEventId: string | null;
  createdAt: string;
};

export type OpsUsageDay = {
  date: string;
  requests: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cost: number;
  fallbackCount: number;
  avgLatencyMs: number | null;
};

export type OpsUsageSummary = {
  requests: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cost: number;
  fallbackCount: number;
  avgLatencyMs: number | null;
  uniquePayers: number;
  uniqueApiKeys: number;
};

export type OpsMcpEvent = {
  id: string;
  ts: string;
  tool: string;
  callerId: string;
  authSource: string;
  ok: boolean;
  level: string;
  latencyMs?: number;
  detail?: string;
};

export type OpsMcpEventDetail = OpsMcpEvent & {
  object: "ops_mcp_event";
};

export type OpsCreditEvent = {
  id: string;
  apiKeyId: string;
  amount: number;
  balanceAfter: number | null;
  source: "usdc_deposit" | "unknown";
  txHash: string | null;
  wallet: string | null;
  creditedAt: string;
};

export type OpsRecentSignup = {
  id: string;
  email: string | null;
  wallet: string | null;
  createdAt: string;
  creditBalance: number;
};

export type OpsActivityItem =
  | {
      kind: "payment";
      id: string;
      at: string;
      channel: "x402";
      label: string;
      status: string;
      amount: number;
      model: string;
      wallet: string;
      txHash: string | null;
    }
  | {
      kind: "usage";
      id: string;
      at: string;
      channel: "x402" | "balance";
      label: string;
      provider: string;
      model: string;
      tokens: number;
      cost: number;
      latencyMs: number;
      fallbackUsed: boolean;
    }
  | {
      kind: "mcp";
      id: string;
      at: string;
      channel: "mcp";
      label: string;
      tool: string;
      ok: boolean;
      callerId: string;
      authSource: string;
      latencyMs?: number;
      detail?: string;
    }
  | {
      kind: "signup";
      id: string;
      at: string;
      channel: "signup";
      label: string;
      email: string | null;
      wallet: string | null;
      creditBalance: number;
    }
  | {
      kind: "credit";
      id: string;
      at: string;
      channel: "balance";
      label: string;
      apiKeyId: string;
      amount: number;
      balanceAfter: number | null;
      source: string;
      txHash: string | null;
      wallet: string | null;
    };

export type IrregularitySeverity = "info" | "warn" | "critical";

export type OpsIrregularityDiagnostic = {
  label: string;
  value: string;
  tone?: "info" | "warn" | "error";
};

export type OpsIrregularityHealthRecord = {
  name: string;
  healthy: boolean;
  latencyMs: number | null;
  lastCheck: number | null;
  statusCode?: number;
  errorDetail?: string;
  checkUrl?: string;
  lastHealthyAt?: string | null;
  likelyCause?: string | null;
};

export type OpsPaymentRecord = Omit<OpsPaymentDetail, "object"> & {
  ageMinutes?: number;
};

export type OpsIrregularityRecord =
  | { kind: "payment"; data: OpsPaymentRecord }
  | { kind: "usage"; data: OpsUsageDetail }
  | { kind: "health"; data: OpsIrregularityHealthRecord }
  | { kind: "mcp"; data: OpsMcpEvent };

export type OpsIrregularity = {
  id: string;
  severity: IrregularitySeverity;
  category: "health" | "payments" | "usage" | "mcp" | "config";
  title: string;
  detail: string;
  action: string;
  metric?: string;
  relatedIds?: string[];
  diagnostics?: OpsIrregularityDiagnostic[];
  records?: OpsIrregularityRecord[];
};

export type StuckPayment = OpsPaymentRecord & {
  ageMinutes: number;
};

export type OpsOverview = {
  object: "ops_overview";
  generatedAt: string;
  windowDays: number;
  storage: "postgres" | "file";
  server: {
    x402Enabled: boolean;
    paymentStore: "ready" | "disabled";
    providersConfigured: string[];
    fallbackChain: string[];
  };
  health: {
    healthyCount: number;
    providerCount: number;
    providers: Record<string, OpsProviderStatus>;
  };
  payments: {
    recent: OpsPayment[];
    statusCounts: Record<string, number>;
  };
  usage: {
    summary: OpsUsageSummary;
    history: OpsUsageDay[];
    recent: Array<{
      id: string;
      channel: OpsChannel;
      provider: string;
      model: string;
      resourceType: string;
      totalTokens: number;
      cost: number;
      latencyMs: number;
      fallbackUsed: boolean;
      success: boolean;
      errorCode: string | null;
      unitPrice: number | null;
      createdAt: string;
    }>;
  };
  reliability: {
    object: "reliability_telemetry";
    windowDays: number;
    resourceType: string | null;
    overall: {
      attempts: number;
      successes: number;
      failures: number;
      successRate: number;
      avgLatencyMs: number | null;
      avgUnitPrice: number | null;
    };
    byProvider: Array<{
      resourceType: string;
      provider: string;
      attempts: number;
      successes: number;
      failures: number;
      successRate: number;
      avgLatencyMs: number | null;
      avgUnitPrice: number | null;
    }>;
    series: Array<{
      date: string;
      resourceType: string;
      provider: string;
      model: string;
      attempts: number;
      successes: number;
      failures: number;
      successRate: number;
      avgLatencyMs: number | null;
      avgUnitPrice: number | null;
      avgCost: number | null;
    }>;
  } | null;
  mcp: {
    buffered: number;
    recent: OpsMcpEvent[];
  };
  signups: {
    recent: OpsRecentSignup[];
  };
  credits: {
    recent: OpsCreditEvent[];
  };
  paymentsStuck: StuckPayment[];
  attention: {
    critical: number;
    warn: number;
    info: number;
  };
  irregularities: OpsIrregularity[];
  activity: OpsActivityItem[];
};
