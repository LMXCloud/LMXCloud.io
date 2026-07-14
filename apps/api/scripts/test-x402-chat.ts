/**
 * x402 chat completion test script.
 *
 * Phase 1 (no wallet): expects HTTP 402 with payment instructions.
 * Phase 2 (--pay): signs and pays via x402 client, expects HTTP 200 completion.
 *
 * Usage:
 *   pnpm test:x402
 *   API_URL=http://localhost:3000 MODEL=llama-3-70b PAYER_PRIVATE_KEY=0x... pnpm test:x402 -- --pay
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
const envFile = process.argv.includes("--mainnet")
  ? ".env.mainnet"
  : ".env";
dotenv.config({ path: path.resolve(__dirname, "../../../", envFile) });

const API_URL = process.env.API_URL ?? "http://localhost:3000";
const MODEL = process.env.MODEL ?? "llama-3-70b";
const CHAIN_ID = Number(process.env.SIWE_CHAIN_ID ?? 84532);
const NETWORK = `eip155:${CHAIN_ID}` as const;
const RPC_URL = process.env.BASE_RPC_URL;
const USDC_ADDRESS = process.env.USDC_CONTRACT_ADDRESS as `0x${string}` | undefined;
const PAY = process.argv.includes("--pay");
const PAID_REQUEST_TIMEOUT_MS = Number(process.env.X402_TEST_TIMEOUT_MS ?? 600_000);
const REPEAT = parsePositiveIntFlag("--repeat", Number(process.env.X402_TEST_REPEAT ?? 1));
const DELAY_MS = parseNonNegativeIntFlag(
  "--delay-ms",
  Number(process.env.X402_TEST_DELAY_MS ?? 0),
);

function parsePositiveIntFlag(flag: string, fallback: number): number {
  const index = process.argv.indexOf(flag);
  if (index === -1) return fallback;
  const raw = process.argv[index + 1];
  if (!raw) {
    throw new Error(`${flag} requires a value`);
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${flag} must be a positive integer`);
  }
  return value;
}

function parseNonNegativeIntFlag(flag: string, fallback: number): number {
  const index = process.argv.indexOf(flag);
  if (index === -1) return fallback;
  const raw = process.argv[index + 1];
  if (!raw) {
    throw new Error(`${flag} requires a value`);
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${flag} must be a non-negative integer`);
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

async function chatFetch(
  body: string,
  headers?: Record<string, string>,
): Promise<Response> {
  return fetch(`${API_URL}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body,
  });
}

function chainForId(chainId: number) {
  return chainId === 84532 ? baseSepolia : base;
}

function decodePaymentError(header: string | null): string | undefined {
  if (!header) return undefined;
  try {
    const json = JSON.parse(Buffer.from(header, "base64").toString("utf8")) as {
      error?: string;
    };
    return json.error;
  } catch {
    return undefined;
  }
}

/** Read EXTENSION-RESPONSES from a settle (paid) HTTP response. */
function getExtensionResponsesHeader(headers: Headers): string | null {
  return (
    headers.get("extension-responses") ??
    headers.get("EXTENSION-RESPONSES")
  );
}

function decodeExtensionResponses(
  header: string | null,
): Record<string, unknown> | null {
  if (!header) return null;
  try {
    const decoded = JSON.parse(
      Buffer.from(header, "base64").toString("utf8"),
    ) as unknown;
    if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) {
      return { decodeError: true, raw: header };
    }
    return decoded as Record<string, unknown>;
  } catch {
    return { decodeError: true, raw: header };
  }
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
      `Payer wallet has no ETH for gas on ${chain.name}. Fund the payer wallet before running --pay.`,
    );
  }
  if ((usdcBalance as bigint) < requiredAmount) {
    throw new Error(
      `Payer wallet needs at least ${formatUnits(requiredAmount, 6)} USDC on ${chain.name}.`,
    );
  }

  if ((allowance as bigint) >= requiredAmount) {
    return;
  }

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

async function unpaidRequest(): Promise<Response> {
  return chatFetch(
    JSON.stringify({
      model: MODEL,
      messages: [{ role: "user", content: "Reply with exactly: x402-ok" }],
      max_tokens: 16,
    }),
  );
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

async function paidRequest(): Promise<void> {
  const privateKeyRaw = process.env.PAYER_PRIVATE_KEY;
  if (!privateKeyRaw) {
    throw new Error("PAYER_PRIVATE_KEY is required for --pay");
  }
  if (!RPC_URL) {
    throw new Error("BASE_RPC_URL is required for --pay");
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

  const initial = await unpaidRequest();
  const initialBody = await initial.json().catch(() => ({}));
  if (initial.status !== 402) {
    throw new Error(
      `Expected 402 Payment Required from ${API_URL}/v1/chat/completions, ` +
        `got ${initial.status}: ${JSON.stringify(initialBody)}. ` +
        `If this is production, confirm X402_ENABLED=true and a redeploy completed ` +
        `(GET /health should show "x402_enabled": true).`,
    );
  }

  const paymentRequired = httpClient.getPaymentRequiredResponse(
    (name) => initial.headers.get(name),
    initialBody,
  );

  const tokenAddress = (paymentRequired.accepts[0]?.asset ?? USDC_ADDRESS) as `0x${string}`;
  const requiredAmount = BigInt(paymentRequired.accepts[0]?.amount ?? "1000");
  if (!tokenAddress) {
    throw new Error("USDC_CONTRACT_ADDRESS is required for --pay");
  }

  await ensurePermit2Allowance(account, tokenAddress, requiredAmount);

  const paymentPayload = await httpClient.createPaymentPayload(paymentRequired);
  const paymentHeaders = httpClient.encodePaymentSignatureHeader(paymentPayload);

  const paid = await chatFetch(
    JSON.stringify({
      model: MODEL,
      messages: [{ role: "user", content: "Reply with exactly: x402-ok" }],
      max_tokens: 16,
    }),
    paymentHeaders,
  );

  const body = await paid.json().catch(() => ({}));
  const responseHeaders = Object.fromEntries(paid.headers.entries());
  let settlement: unknown = null;
  try {
    settlement = httpClient.getPaymentSettleResponse((name) => paid.headers.get(name));
  } catch {
    // Settlement header is only present after successful on-chain settle.
  }

  // Facilitator settle status for Bazaar / other extensions (docs: EXTENSION-RESPONSES).
  const extensionResponsesHeader = getExtensionResponsesHeader(paid.headers);
  const extensionResponses = decodeExtensionResponses(extensionResponsesHeader);
  console.log(
    `EXTENSION-RESPONSES (settle): ${extensionResponsesHeader ?? "(missing)"}`,
  );
  if (extensionResponses) {
    console.log(
      `EXTENSION-RESPONSES decoded: ${JSON.stringify(extensionResponses, null, 2)}`,
    );
  }

  console.log(JSON.stringify({
    status: paid.status,
    paymentError: decodePaymentError(
      paid.headers.get("payment-required") ?? paid.headers.get("x-payment-required"),
    ),
    provider: paid.headers.get("x-lmx-provider"),
    cost: paid.headers.get("x-lmx-cost"),
    paymentResponseHeader:
      paid.headers.get("payment-response") ?? paid.headers.get("x-payment-response"),
    extensionResponsesHeader,
    extensionResponses,
    settlement,
    responseHeaders,
    body,
  }, null, 2));

  if (paid.status !== 200) {
    const paymentError = decodePaymentError(
      paid.headers.get("payment-required") ?? paid.headers.get("x-payment-required"),
    );
    throw new Error(
      paymentError
        ? `Paid request failed with ${paid.status}: ${paymentError}`
        : `Paid request failed with ${paid.status}`,
    );
  }
}

async function main(): Promise<void> {
  if (PAY) {
    configureLongFetchTimeout();
    for (let i = 1; i <= REPEAT; i += 1) {
      console.log(`x402 paid run ${i}/${REPEAT}...`);
      await paidRequest();
      console.log(`x402 paid run ${i}/${REPEAT}: OK`);
      await sleep(DELAY_MS);
    }
    console.log(`x402 paid chat completion soak: OK (${REPEAT} runs)`);
    return;
  }

  for (let i = 1; i <= REPEAT; i += 1) {
    console.log(`x402 unpaid run ${i}/${REPEAT}...`);
    const response = await unpaidRequest();
    const body = await response.json().catch(() => ({}));

    console.log(JSON.stringify({
      run: i,
      status: response.status,
      paymentRequiredHeader: response.headers.get("payment-required") ?? response.headers.get("x-payment-required"),
      body,
    }, null, 2));

    if (response.status !== 402) {
      throw new Error(`Expected 402 without payment, got ${response.status}`);
    }
    await sleep(DELAY_MS);
  }

  console.log(`x402 unpaid probe soak: OK (${REPEAT} runs)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
