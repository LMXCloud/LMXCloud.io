import dotenv from "dotenv";

import path from "path";

import { fileURLToPath } from "url";

import { getAddress } from "viem";

import { resolveMaxDepositUsdc } from "./deposits/limits.js";
import {
  DEFAULT_MAX_COMPLETION_TOKENS,
  MIN_CALL_USDC,
  PRICING_MARGIN_PCT,
  toCaip2ChainId,
} from "./pricing/constants.js";



const __dirname = path.dirname(fileURLToPath(import.meta.url));

const envFile =
  process.env.LMX_ENV_FILE ??
  (process.env.LMX_ENV === "mainnet" ? ".env.mainnet" : ".env");
dotenv.config({ path: path.resolve(__dirname, "../../../", envFile) });



export interface ProviderConfig {

  apiKey: string;

  baseUrl: string;

}



export interface Config {

  port: number;

  host: string;

  healthPollIntervalMs: number;

  ionet: ProviderConfig;

  akash?: ProviderConfig;

  together?: ProviderConfig;

  keyGenRateLimitMax: number;

  keyGenRateLimitWindowMs: number;

  chatRateLimitMax: number;

  chatRateLimitWindowMs: number;

  initialCreditBalance: number;

  minChatCost: number;

  sessionSecret: string;

  sessionTtlMs: number;

  clerkSecretKey?: string;

  siwe: {
    domain: string;
    uri: string;
    chainId: number;
  };

  deposits?: {
    rpcUrl: string;
    treasuryAddress: string;
    usdcContractAddress: string;
    chainId: number;
    chainLabel: string;
    confirmations: number;
    pollIntervalMs: number;
    lookbackBlocks: number;
    maxLogBlockRange: number;
    maxDepositUsdc: number;
  };

  anchoring?: {
    rpcUrl: string;
    chainId: number;
    contractAddress: `0x${string}`;
    privateKey: `0x${string}`;
    pollIntervalMs: number;
    minEvents: number;
    maxEvents: number;
  };

  x402: {
    enabled: boolean;
    facilitatorUrl: string;
    cdpApiKeyId?: string;
    cdpApiKeySecret?: string;
    payToAddress?: string;
    networkId: string;
    minCallUsdc: number;
    defaultMaxCompletionTokens: number;
    marginPct: number;
  };

}



function requireEnv(name: string): string {

  const value = process.env[name];

  if (!value) {

    throw new Error(`Missing required environment variable: ${name}`);

  }

  return value;

}



function parsePositiveInt(
  name: string,
  raw: string | undefined,
  fallback: number,
): number {
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}



function validateEthereumAddress(name: string, value: string): string {
  try {
    return getAddress(value);
  } catch {
    throw new Error(`${name} is not a valid Ethereum address`);
  }
}

function parsePrivateKey(name: string, value: string): `0x${string}` {
  const trimmed = value.trim();
  const hex = trimmed.startsWith("0x") ? trimmed : `0x${trimmed}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error(`${name} must be a 32-byte hex private key`);
  }
  return hex as `0x${string}`;
}



function assertProductionSafety(config: Config): void {
  const isProduction = process.env.NODE_ENV === "production";
  if (!isProduction) return;

  if (
    !config.sessionSecret ||
    config.sessionSecret === "change-me-in-production" ||
    config.sessionSecret.length < 32
  ) {
    throw new Error(
      "SESSION_SECRET must be a random string of at least 32 characters in production",
    );
  }

  if (config.siwe.domain === "localhost") {
    throw new Error("SIWE_DOMAIN must be set to your production hostname");
  }

  if (config.siwe.uri.startsWith("http://localhost")) {
    throw new Error("SIWE_URI must be your production dashboard URL");
  }

  if (process.env.CREDITS_ALLOW_SELF_TOPUP === "true") {
    throw new Error(
      "CREDITS_ALLOW_SELF_TOPUP must not be enabled in production",
    );
  }

  if (process.env.TREASURY_ADDRESS && !config.deposits) {
    throw new Error(
      "TREASURY_ADDRESS is set but deposits are not fully configured — set DATABASE_URL and BASE_RPC_URL",
    );
  }

  if (process.env.ANCHOR_CONTRACT_ADDRESS && !config.anchoring) {
    throw new Error(
      "ANCHOR_CONTRACT_ADDRESS is set but anchoring is not fully configured — set DATABASE_URL, BASE_RPC_URL, and ANCHOR_PRIVATE_KEY",
    );
  }

  if (process.env.X402_ENABLED === "true") {
    if (!process.env.DATABASE_URL) {
      throw new Error("X402_ENABLED requires DATABASE_URL");
    }
    if (!process.env.TREASURY_ADDRESS) {
      throw new Error("X402_ENABLED requires TREASURY_ADDRESS");
    }
    if (!process.env.CDP_API_KEY_ID || !process.env.CDP_API_KEY_SECRET) {
      throw new Error("X402_ENABLED requires CDP_API_KEY_ID and CDP_API_KEY_SECRET");
    }
  }
}



function optionalProvider(prefix: string): ProviderConfig | undefined {

  const apiKey = process.env[`${prefix}_API_KEY`];

  if (!apiKey) return undefined;



  const baseUrlKey = `${prefix}_BASE_URL`;

  const defaultUrls: Record<string, string> = {

    AKASHML: "https://api.akashml.com/v1",

    TOGETHER: "https://api.together.xyz/v1",

  };



  return {

    apiKey,

    baseUrl: process.env[baseUrlKey] ?? defaultUrls[prefix] ?? "",

  };

}



export function loadConfig(): Config {
  const siweDomain = process.env.SIWE_DOMAIN ?? "localhost";
  const siweUri = process.env.SIWE_URI ?? "http://localhost:5173";
  const siweChainId = Number(process.env.SIWE_CHAIN_ID ?? 8453);
  const depositChainLabel =
    siweChainId === 84532 ? "base-sepolia" : "base";

  const baseRpcUrl = process.env.BASE_RPC_URL;
  const treasuryAddress = process.env.TREASURY_ADDRESS;
  const maxDepositUsdc = resolveMaxDepositUsdc();
  const deposits =
    baseRpcUrl && treasuryAddress && process.env.DATABASE_URL
      ? {
          rpcUrl: baseRpcUrl,
          treasuryAddress: validateEthereumAddress(
            "TREASURY_ADDRESS",
            treasuryAddress,
          ).toLowerCase(),
          usdcContractAddress: validateEthereumAddress(
            "USDC_CONTRACT_ADDRESS",
            process.env.USDC_CONTRACT_ADDRESS ??
              (siweChainId === 84532
                ? "0x036CbD53842c5426634e7929541eC2318f3dCF7e"
                : "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"),
          ).toLowerCase(),
          chainId: siweChainId,
          chainLabel: depositChainLabel,
          confirmations: parsePositiveInt(
            "DEPOSIT_CONFIRMATIONS",
            process.env.DEPOSIT_CONFIRMATIONS,
            10,
          ),
          pollIntervalMs: parsePositiveInt(
            "DEPOSIT_POLL_INTERVAL_MS",
            process.env.DEPOSIT_POLL_INTERVAL_MS,
            15_000,
          ),
          lookbackBlocks: parsePositiveInt(
            "DEPOSIT_LOOKBACK_BLOCKS",
            process.env.DEPOSIT_LOOKBACK_BLOCKS,
            100,
          ),
          maxLogBlockRange: parsePositiveInt(
            "DEPOSIT_MAX_LOG_BLOCK_RANGE",
            process.env.DEPOSIT_MAX_LOG_BLOCK_RANGE,
            2000,
          ),
          maxDepositUsdc,
        }
      : undefined;

  const anchorContractAddress = process.env.ANCHOR_CONTRACT_ADDRESS;
  const anchorPrivateKey = process.env.ANCHOR_PRIVATE_KEY;
  const anchoring =
    baseRpcUrl &&
    anchorContractAddress &&
    anchorPrivateKey &&
    process.env.DATABASE_URL
      ? {
          rpcUrl: baseRpcUrl,
          chainId: siweChainId,
          contractAddress: validateEthereumAddress(
            "ANCHOR_CONTRACT_ADDRESS",
            anchorContractAddress,
          ) as `0x${string}`,
          privateKey: parsePrivateKey("ANCHOR_PRIVATE_KEY", anchorPrivateKey),
          pollIntervalMs: parsePositiveInt(
            "ANCHOR_BATCH_INTERVAL_MS",
            process.env.ANCHOR_BATCH_INTERVAL_MS,
            300_000,
          ),
          minEvents: parsePositiveInt(
            "ANCHOR_BATCH_MIN_EVENTS",
            process.env.ANCHOR_BATCH_MIN_EVENTS,
            1,
          ),
          maxEvents: parsePositiveInt(
            "ANCHOR_BATCH_MAX_EVENTS",
            process.env.ANCHOR_BATCH_MAX_EVENTS,
            5000,
          ),
        }
      : undefined;

  const config: Config = {
    port: Number(process.env.PORT ?? 3000),
    host: process.env.HOST ?? "0.0.0.0",
    healthPollIntervalMs: Number(process.env.HEALTH_POLL_INTERVAL_MS ?? 30_000),
    ionet: {
      apiKey: requireEnv("IONET_API_KEY"),
      baseUrl: process.env.IONET_BASE_URL ?? "https://api.intelligence.io.solutions/api/v1",
    },
    akash: optionalProvider("AKASHML"),
    together: optionalProvider("TOGETHER"),
    // Conservative default rate limit for key generation during free beta; can be loosened after monitoring abuse patterns.
    keyGenRateLimitMax: Number(process.env.KEY_GEN_RATE_LIMIT_MAX ?? 5),
    keyGenRateLimitWindowMs: Number(process.env.KEY_GEN_RATE_LIMIT_WINDOW_MS ?? 3_600_000),
    // Conservative default rate limit for chat completions during free beta; can be loosened after monitoring abuse patterns.
    chatRateLimitMax: Number(process.env.CHAT_RATE_LIMIT_MAX ?? 30),
    chatRateLimitWindowMs: Number(process.env.CHAT_RATE_LIMIT_WINDOW_MS ?? 60_000),
    initialCreditBalance: Number(process.env.INITIAL_CREDIT_BALANCE ?? 1),
    minChatCost: Number(process.env.MIN_CHAT_COST ?? 0.00001),
    sessionSecret: requireEnv("SESSION_SECRET"),
    sessionTtlMs: Number(process.env.SESSION_TTL_MS ?? 30 * 24 * 60 * 60 * 1000),
    clerkSecretKey: process.env.CLERK_SECRET_KEY,
    siwe: {
      domain: siweDomain,
      uri: siweUri,
      chainId: siweChainId,
    },
    deposits,
    anchoring,
    x402: {
      enabled: process.env.X402_ENABLED === "true",
      facilitatorUrl:
        process.env.X402_FACILITATOR_URL ??
        "https://api.cdp.coinbase.com/platform/v2/x402",
      cdpApiKeyId: process.env.CDP_API_KEY_ID,
      cdpApiKeySecret: process.env.CDP_API_KEY_SECRET,
      payToAddress: deposits?.treasuryAddress,
      networkId: toCaip2ChainId(siweChainId),
      minCallUsdc: Number(process.env.X402_MIN_CALL_USDC ?? MIN_CALL_USDC),
      defaultMaxCompletionTokens: parsePositiveInt(
        "X402_DEFAULT_MAX_COMPLETION_TOKENS",
        process.env.X402_DEFAULT_MAX_COMPLETION_TOKENS,
        DEFAULT_MAX_COMPLETION_TOKENS,
      ),
      marginPct: Number(process.env.X402_PRICING_MARGIN_PCT ?? PRICING_MARGIN_PCT),
    },
  };

  assertProductionSafety(config);
  return config;
}
