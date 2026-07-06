import dotenv from "dotenv";

import path from "path";

import { fileURLToPath } from "url";



const __dirname = path.dirname(fileURLToPath(import.meta.url));

dotenv.config({ path: path.resolve(__dirname, "../../../.env") });



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

}



function requireEnv(name: string): string {

  const value = process.env[name];

  if (!value) {

    throw new Error(`Missing required environment variable: ${name}`);

  }

  return value;

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

  return {

    port: Number(process.env.PORT ?? 3000),

    host: process.env.HOST ?? "0.0.0.0",

    healthPollIntervalMs: Number(process.env.HEALTH_POLL_INTERVAL_MS ?? 30_000),

    ionet: {

      apiKey: requireEnv("IONET_API_KEY"),

      baseUrl: process.env.IONET_BASE_URL ?? "https://api.intelligence.io.solutions/api/v1",

    },

    akash: optionalProvider("AKASHML"),

    together: optionalProvider("TOGETHER"),

    keyGenRateLimitMax: Number(process.env.KEY_GEN_RATE_LIMIT_MAX ?? 10),

    keyGenRateLimitWindowMs: Number(process.env.KEY_GEN_RATE_LIMIT_WINDOW_MS ?? 3_600_000),

    chatRateLimitMax: Number(process.env.CHAT_RATE_LIMIT_MAX ?? 60),

    chatRateLimitWindowMs: Number(process.env.CHAT_RATE_LIMIT_WINDOW_MS ?? 60_000),

    initialCreditBalance: Number(process.env.INITIAL_CREDIT_BALANCE ?? 1),

    minChatCost: Number(process.env.MIN_CHAT_COST ?? 0.00001),

    sessionSecret:
      process.env.SESSION_SECRET ?? "lmxcloud-dev-session-secret-change-me",

    sessionTtlMs: Number(process.env.SESSION_TTL_MS ?? 30 * 24 * 60 * 60 * 1000),

    clerkSecretKey: process.env.CLERK_SECRET_KEY,

  };

}
