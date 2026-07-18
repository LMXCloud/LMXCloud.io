/**
 * Concurrent HTTP burst tests for x402 chat payments.
 *
 * Covers gaps the sequential --repeat/--delay-ms soak never hits:
 *   1. Replay race — one signed payload, N concurrent POSTs (atomic claim over HTTP)
 *   2. Anon rate limit — many distinct payments from one wallet in a tight burst
 *   3. Malformed headers — garbage PAYMENT-SIGNATURE under volume
 *
 * Defaults to Base Sepolia (.env). Prefer local API_URL — this is adversarial load.
 *
 * Usage:
 *   pnpm --filter @lmxcloud/api test:x402:burst
 *   pnpm --filter @lmxcloud/api exec tsx scripts/test-x402-burst.ts -- --replay
 *   pnpm --filter @lmxcloud/api exec tsx scripts/test-x402-burst.ts -- --rate-limit --malformed
 *   pnpm --filter @lmxcloud/api exec tsx scripts/test-x402-burst.ts -- --concurrency 8 --rate-burst 25
 */
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { privateKeyToAccount } from "viem/accounts";
import {
  createPublicClient,
  createWalletClient,
  formatEther,
  formatUnits,
  http,
} from "viem";
import { base, baseSepolia } from "viem/chains";
import { x402Client, x402HTTPClient } from "@x402/core/client";
import {
  UptoEvmScheme,
  createPermit2ApprovalTx,
  getPermit2AllowanceReadParams,
  toClientEvmSigner,
} from "@x402/evm";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envFile = process.argv.includes("--mainnet") ? ".env.mainnet" : ".env";
dotenv.config({ path: path.resolve(__dirname, "../../../", envFile) });

const API_URL = process.env.API_URL ?? "http://localhost:3000";
const MODEL = process.env.MODEL ?? "llama-3-70b";
const CHAIN_ID = Number(process.env.SIWE_CHAIN_ID ?? 84532);
const NETWORK = `eip155:${CHAIN_ID}` as const;
const RPC_URL = process.env.BASE_RPC_URL;
const USDC_ADDRESS = process.env.USDC_CONTRACT_ADDRESS as `0x${string}` | undefined;
const PAID_REQUEST_TIMEOUT_MS = Number(process.env.X402_TEST_TIMEOUT_MS ?? 600_000);
const RATE_LIMIT_MAX = Number(
  process.env.X402_ANON_RATE_LIMIT_MAX ?? process.env.X402_RATE_LIMIT_MAX ?? 10,
);
const RATE_LIMIT_WINDOW_MS = Number(
  process.env.X402_ANON_RATE_LIMIT_WINDOW_MS ??
    process.env.X402_RATE_LIMIT_WINDOW_MS ??
    60_000,
);

const RUN_REPLAY =
  process.argv.includes("--replay") ||
  (!process.argv.includes("--rate-limit") && !process.argv.includes("--malformed"));
const RUN_RATE_LIMIT =
  process.argv.includes("--rate-limit") ||
  (!process.argv.includes("--replay") && !process.argv.includes("--malformed"));
const RUN_MALFORMED =
  process.argv.includes("--malformed") ||
  (!process.argv.includes("--replay") && !process.argv.includes("--rate-limit"));

// When no scenario flags are passed, run all three.
const RUN_ALL =
  !process.argv.includes("--replay") &&
  !process.argv.includes("--rate-limit") &&
  !process.argv.includes("--malformed");

const CONCURRENCY = parsePositiveIntFlag(
  "--concurrency",
  Number(process.env.X402_BURST_CONCURRENCY ?? 8),
);
const RATE_BURST = parsePositiveIntFlag(
  "--rate-burst",
  Number(process.env.X402_BURST_RATE_COUNT ?? RATE_LIMIT_MAX + 15),
);
const MALFORMED_BURST = parsePositiveIntFlag(
  "--malformed-burst",
  Number(process.env.X402_BURST_MALFORMED_COUNT ?? 40),
);

type ScenarioResult = {
  scenario: string;
  pass: boolean;
  expected: Record<string, number>;
  actual: Record<string, number>;
  detail?: Record<string, unknown>;
};

function parsePositiveIntFlag(flag: string, fallback: number): number {
  const index = process.argv.indexOf(flag);
  if (index === -1) return fallback;
  const raw = process.argv[index + 1];
  if (!raw) throw new Error(`${flag} requires a value`);
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${flag} must be a positive integer`);
  }
  return value;
}

async function sleep(ms: number): Promise<void> {
  if (ms <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function configureLongFetchTimeout(): void {
  process.env.UNDICI_HEADERS_TIMEOUT = String(PAID_REQUEST_TIMEOUT_MS);
  process.env.UNDICI_BODY_TIMEOUT = String(PAID_REQUEST_TIMEOUT_MS);
}

function chainForId(chainId: number) {
  return chainId === 84532 ? baseSepolia : base;
}

function normalizePrivateKey(raw: string): `0x${string}` {
  const trimmed = raw.trim();
  const hex = trimmed.startsWith("0x") ? trimmed.slice(2) : trimmed;
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error(
      "PAYER_PRIVATE_KEY must be 64 hex characters (with or without 0x prefix)",
    );
  }
  return `0x${hex}`;
}

function chatBody(): string {
  return JSON.stringify({
    model: MODEL,
    messages: [{ role: "user", content: "Reply with exactly: x402-ok" }],
    max_tokens: 16,
  });
}

async function chatFetch(
  body: string,
  headers?: Record<string, string>,
  timeoutMs = PAID_REQUEST_TIMEOUT_MS,
): Promise<{ status: number; ok: boolean; error?: string; ms: number }> {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${API_URL}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...headers,
      },
      body,
      signal: controller.signal,
    });
    // Drain body so the connection can close; ignore parse failures.
    await response.text().catch(() => undefined);
    return {
      status: response.status,
      ok: response.ok,
      ms: Date.now() - started,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      status: 0,
      ok: false,
      error: message,
      ms: Date.now() - started,
    };
  } finally {
    clearTimeout(timer);
  }
}

function countByStatus(
  results: Array<{ status: number }>,
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const r of results) {
    const key = String(r.status);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

async function ensurePermit2Allowance(
  account: ReturnType<typeof privateKeyToAccount>,
  tokenAddress: `0x${string}`,
  requiredAmount: bigint,
): Promise<void> {
  const chain = chainForId(CHAIN_ID);
  const publicClient = createPublicClient({ chain, transport: http(RPC_URL!) });
  const walletClient = createWalletClient({
    account,
    chain,
    transport: http(RPC_URL!),
  });

  const [ethBalance, usdcBalance, allowance] = await Promise.all([
    publicClient.getBalance({ address: account.address }),
    publicClient.readContract({
      address: tokenAddress,
      abi: [
        {
          name: "balanceOf",
          type: "function",
          stateMutability: "view",
          inputs: [{ name: "", type: "address" }],
          outputs: [{ type: "uint256" }],
        },
      ],
      functionName: "balanceOf",
      args: [account.address],
    }),
    publicClient.readContract(
      getPermit2AllowanceReadParams({
        tokenAddress,
        ownerAddress: account.address,
      }),
    ),
  ]);

  console.log(
    JSON.stringify({
      payer: account.address,
      eth: formatEther(ethBalance),
      usdc: formatUnits(usdcBalance, 6),
      permit2Allowance: formatUnits(allowance as bigint, 6),
    }),
  );

  if (ethBalance === 0n) {
    throw new Error(
      `Payer wallet has no ETH for gas on ${chain.name}. Fund the payer wallet before running burst tests.`,
    );
  }
  if ((usdcBalance as bigint) < requiredAmount) {
    throw new Error(
      `Payer wallet needs at least ${formatUnits(requiredAmount, 6)} USDC on ${chain.name}.`,
    );
  }

  if ((allowance as bigint) >= requiredAmount) return;

  console.log("Approving USDC for Permit2 (one-time setup)...");
  const approvalTx = createPermit2ApprovalTx(tokenAddress);
  const hash = await walletClient.sendTransaction({
    account,
    chain,
    to: approvalTx.to,
    data: approvalTx.data,
  });
  await publicClient.waitForTransactionReceipt({ hash });
  console.log(`Permit2 approval confirmed: ${hash}`);
}

type PaidClient = {
  account: ReturnType<typeof privateKeyToAccount>;
  httpClient: x402HTTPClient;
  paymentRequired: ReturnType<x402HTTPClient["getPaymentRequiredResponse"]>;
};

async function setupPaidClient(): Promise<PaidClient> {
  const privateKeyRaw = process.env.PAYER_PRIVATE_KEY;
  if (!privateKeyRaw) {
    throw new Error("PAYER_PRIVATE_KEY is required for burst tests");
  }
  if (!RPC_URL) {
    throw new Error("BASE_RPC_URL is required for burst tests");
  }
  if (process.argv.includes("--mainnet")) {
    console.warn(
      "WARNING: --mainnet burst testing is adversarial load against production money paths. Prefer Sepolia.",
    );
  }

  const account = privateKeyToAccount(normalizePrivateKey(privateKeyRaw));
  const chain = chainForId(CHAIN_ID);
  const publicClient = createPublicClient({ chain, transport: http(RPC_URL) });
  const walletClient = createWalletClient({
    account,
    chain,
    transport: http(RPC_URL),
  });
  const signer = toClientEvmSigner(
    {
      address: account.address,
      signTypedData: (msg) => account.signTypedData(msg),
      signTransaction: (args) => walletClient.signTransaction(args),
    },
    publicClient,
  );

  const client = new x402Client();
  client.register(NETWORK, new UptoEvmScheme(signer, { rpcUrl: RPC_URL }));
  const httpClient = new x402HTTPClient(client);

  const initial = await fetch(`${API_URL}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: chatBody(),
  });
  const initialBody = await initial.json().catch(() => ({}));
  if (initial.status !== 402) {
    throw new Error(
      `Expected 402 Payment Required from ${API_URL}/v1/chat/completions, ` +
        `got ${initial.status}: ${JSON.stringify(initialBody)}. ` +
        `Confirm X402_ENABLED=true and GET /health shows "x402_enabled": true.`,
    );
  }

  const paymentRequired = httpClient.getPaymentRequiredResponse(
    (name) => initial.headers.get(name),
    initialBody,
  );

  const tokenAddress = (paymentRequired.accepts[0]?.asset ?? USDC_ADDRESS) as
    | `0x${string}`
    | undefined;
  const requiredAmount = BigInt(paymentRequired.accepts[0]?.amount ?? "1000");
  if (!tokenAddress) {
    throw new Error("USDC_CONTRACT_ADDRESS is required for burst tests");
  }

  // Rate-limit + replay may settle up to RATE_LIMIT_MAX payments; size allowance for that.
  const allowanceTarget = requiredAmount * BigInt(Math.max(RATE_LIMIT_MAX, RATE_BURST));
  await ensurePermit2Allowance(account, tokenAddress, allowanceTarget);

  return { account, httpClient, paymentRequired };
}

async function runReplay(client: PaidClient): Promise<ScenarioResult> {
  // Stay under the anon rate limit so failures are claim/replay rejects, not 429s.
  const n = Math.min(CONCURRENCY, RATE_LIMIT_MAX);
  if (n < 2) {
    throw new Error(
      `Replay concurrency must be >= 2 (got ${n}). Raise --concurrency or X402_ANON_RATE_LIMIT_MAX.`,
    );
  }
  if (CONCURRENCY > RATE_LIMIT_MAX) {
    console.warn(
      `Replay concurrency capped at rate-limit max (${RATE_LIMIT_MAX}); use --concurrency <= ${RATE_LIMIT_MAX} for a pure claim race.`,
    );
  }

  console.log(`\n=== replay: sign once, fire ${n} concurrent identical payments ===`);

  const paymentPayload = await client.httpClient.createPaymentPayload(
    client.paymentRequired,
  );
  const paymentHeaders =
    client.httpClient.encodePaymentSignatureHeader(paymentPayload);
  const body = chatBody();

  const started = Date.now();
  const results = await Promise.all(
    Array.from({ length: n }, () => chatFetch(body, paymentHeaders)),
  );
  const elapsedMs = Date.now() - started;
  const statusCounts = countByStatus(results);
  const ok200 = statusCounts["200"] ?? 0;
  const replay409 = statusCounts["409"] ?? 0;
  const rejected = n - ok200;

  const expected = { "200": 1, rejected: n - 1 };
  const actual = { "200": ok200, rejected };
  const pass = ok200 === 1 && rejected === n - 1;

  const detail = {
    concurrency: n,
    elapsedMs,
    statusCounts,
    replay409,
    note:
      "Expect exactly one 200 (atomic claim winner); remaining should be rejected (prefer 409 x402_payment_replay).",
    samples: results.slice(0, 5).map((r) => ({
      status: r.status,
      ms: r.ms,
      error: r.error,
    })),
  };

  console.log(JSON.stringify({ scenario: "replay", expected, actual, pass, detail }, null, 2));
  return { scenario: "replay", pass, expected, actual, detail };
}

async function runRateLimit(client: PaidClient): Promise<ScenarioResult> {
  const n = RATE_BURST;
  if (n <= RATE_LIMIT_MAX) {
    throw new Error(
      `--rate-burst (${n}) must exceed X402_ANON_RATE_LIMIT_MAX (${RATE_LIMIT_MAX})`,
    );
  }

  console.log(
    `\n=== rate-limit: ${n} distinct payments from same wallet (max=${RATE_LIMIT_MAX}, windowMs=${RATE_LIMIT_WINDOW_MS}) ===`,
  );

  console.log(`Signing ${n} distinct payment payloads...`);
  const payloads: Awaited<
    ReturnType<x402HTTPClient["createPaymentPayload"]>
  >[] = [];
  for (let i = 0; i < n; i += 1) {
    payloads.push(
      await client.httpClient.createPaymentPayload(client.paymentRequired),
    );
  }

  const body = chatBody();
  const started = Date.now();
  const results = await Promise.all(
    payloads.map((payload) =>
      chatFetch(body, client.httpClient.encodePaymentSignatureHeader(payload)),
    ),
  );
  const elapsedMs = Date.now() - started;
  const statusCounts = countByStatus(results);
  const limited = statusCounts["429"] ?? 0;
  const allowed = n - limited;

  const expected = {
    allowed: RATE_LIMIT_MAX,
    limited: n - RATE_LIMIT_MAX,
  };
  const actual = { allowed, limited };
  // Strict: rate limiter must admit exactly max and reject the rest with 429.
  const pass = allowed === RATE_LIMIT_MAX && limited === n - RATE_LIMIT_MAX;

  const detail = {
    burst: n,
    rateLimitMax: RATE_LIMIT_MAX,
    windowMs: RATE_LIMIT_WINDOW_MS,
    elapsedMs,
    statusCounts,
    allowedStatusBreakdown: Object.fromEntries(
      Object.entries(statusCounts).filter(([k]) => k !== "429"),
    ),
    note:
      "Allowed = non-429 (may be 200 or other post-limit failures). Limited must be HTTP 429.",
    samples: results.slice(0, 5).map((r) => ({
      status: r.status,
      ms: r.ms,
      error: r.error,
    })),
  };

  console.log(
    JSON.stringify({ scenario: "rate-limit", expected, actual, pass, detail }, null, 2),
  );
  return { scenario: "rate-limit", pass, expected, actual, detail };
}

async function runMalformed(): Promise<ScenarioResult> {
  const n = MALFORMED_BURST;
  console.log(`\n=== malformed: ${n} concurrent garbage PAYMENT-SIGNATURE headers ===`);

  const garbageHeaders: Array<Record<string, string>> = [
    { "PAYMENT-SIGNATURE": "not-valid-base64!!!" },
    { "PAYMENT-SIGNATURE": Buffer.from("{}").toString("base64") },
    { "PAYMENT-SIGNATURE": Buffer.from('{"x402Version":1}').toString("base64") },
    { "X-PAYMENT": "%%%%" },
    {
      "PAYMENT-SIGNATURE": Buffer.from(
        JSON.stringify({
          x402Version: 2,
          scheme: "upto",
          network: NETWORK,
          payload: { garbage: true },
        }),
      ).toString("base64"),
    },
  ];

  const body = chatBody();
  const started = Date.now();
  const results = await Promise.all(
    Array.from({ length: n }, (_, i) =>
      chatFetch(body, garbageHeaders[i % garbageHeaders.length], 30_000),
    ),
  );
  const elapsedMs = Date.now() - started;
  const statusCounts = countByStatus(results);

  let status4xx = 0;
  let status5xx = 0;
  let networkErrors = 0;
  for (const r of results) {
    if (r.status === 0 || r.error) networkErrors += 1;
    else if (r.status >= 400 && r.status < 500) status4xx += 1;
    else if (r.status >= 500) status5xx += 1;
  }

  const expected = { "4xx": n, "5xx": 0, networkErrors: 0 };
  const actual = { "4xx": status4xx, "5xx": status5xx, networkErrors };
  const pass = status4xx === n && status5xx === 0 && networkErrors === 0;

  const detail = {
    burst: n,
    elapsedMs,
    statusCounts,
    maxMs: Math.max(...results.map((r) => r.ms)),
    note: "Every request must return 4xx with no hang (status 0) and no 5xx crash.",
    samples: results.slice(0, 5).map((r) => ({
      status: r.status,
      ms: r.ms,
      error: r.error,
    })),
  };

  console.log(
    JSON.stringify({ scenario: "malformed", expected, actual, pass, detail }, null, 2),
  );
  return { scenario: "malformed", pass, expected, actual, detail };
}

async function main(): Promise<void> {
  configureLongFetchTimeout();

  console.log(
    JSON.stringify(
      {
        apiUrl: API_URL,
        model: MODEL,
        chainId: CHAIN_ID,
        network: NETWORK,
        envFile,
        rateLimitMax: RATE_LIMIT_MAX,
        rateLimitWindowMs: RATE_LIMIT_WINDOW_MS,
        concurrency: CONCURRENCY,
        rateBurst: RATE_BURST,
        malformedBurst: MALFORMED_BURST,
        scenarios: {
          replay: RUN_ALL || RUN_REPLAY,
          rateLimit: RUN_ALL || RUN_RATE_LIMIT,
          malformed: RUN_ALL || RUN_MALFORMED,
        },
      },
      null,
      2,
    ),
  );

  const results: ScenarioResult[] = [];
  const needsPaid = RUN_ALL || RUN_REPLAY || RUN_RATE_LIMIT;
  const client = needsPaid ? await setupPaidClient() : null;

  // Malformed first — does not consume wallet rate-limit slots.
  if (RUN_ALL || RUN_MALFORMED) {
    results.push(await runMalformed());
  }

  // Replay next — uses <= RATE_LIMIT_MAX slots on the wallet key.
  if ((RUN_ALL || RUN_REPLAY) && client) {
    results.push(await runReplay(client));
  }

  // Rate-limit last. If replay already touched the wallet bucket, wait for a fresh window.
  if ((RUN_ALL || RUN_RATE_LIMIT) && client) {
    if (RUN_ALL || RUN_REPLAY) {
      const waitMs = RATE_LIMIT_WINDOW_MS + 1_000;
      console.log(
        `\nWaiting ${waitMs}ms for anon rate-limit window to reset before rate-limit burst...`,
      );
      await sleep(waitMs);
    }
    results.push(await runRateLimit(client));
  }

  const summary = {
    pass: results.every((r) => r.pass),
    scenarios: results.map((r) => ({
      scenario: r.scenario,
      pass: r.pass,
      expected: r.expected,
      actual: r.actual,
    })),
  };

  console.log("\n=== summary ===");
  console.log(JSON.stringify(summary, null, 2));

  if (!summary.pass) {
    process.exit(1);
  }
  console.log("x402 burst: OK");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
