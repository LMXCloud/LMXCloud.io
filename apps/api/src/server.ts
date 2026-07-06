import Fastify from "fastify";

import cors from "@fastify/cors";

import { createApiKeyStore, createAuthHook } from "./auth/index.js";

import { loadConfig } from "./config.js";

import { closePool } from "./db/pool.js";

import { HealthMonitor } from "./health/monitor.js";

import { InMemoryHealthStore } from "./health/store.js";

import { createProviderRegistry, getFallbackChain } from "./providers/registry.js";

import { InferenceRouter } from "./routing/router.js";

import { registerAuthRoutes } from "./routes/auth.js";

import { registerChatRoutes } from "./routes/chat.js";

import { registerModelsRoutes } from "./routes/models.js";

import { registerStatusRoutes } from "./routes/status.js";
import { registerUsageRoutes } from "./routes/usage.js";
import { registerBalanceRoutes } from "./routes/balance.js";
import { createRateLimiter } from "./rate-limit.js";
import { createUsageStore } from "./usage/index.js";
import { createCreditStore } from "./credits/index.js";



export async function buildServer() {

  const config = loadConfig();

  const app = Fastify({

    trustProxy: true,

    logger: {

      level: process.env.LOG_LEVEL ?? "info",

    },

  });

  if (!config.clerkSecretKey) {
    app.log.warn("CLERK_SECRET_KEY is not set — POST /v1/auth/clerk will return 503");
  }



  await app.register(cors, {

    origin: true,

    exposedHeaders: [
      "x-lmx-provider",
      "x-lmx-fallback",
      "x-lmx-latency",
      "x-lmx-cost",
      "x-lmx-balance",
    ],

  });



  const providers = createProviderRegistry(config);

  const healthStore = new InMemoryHealthStore();

  const healthMonitor = new HealthMonitor(

    providers,

    healthStore,

    config.healthPollIntervalMs,

  );

  const router = new InferenceRouter(providers, healthStore);

  const apiKeyStore = await createApiKeyStore();

  const usageStore = createUsageStore();

  const creditStore = createCreditStore();

  const authenticate = createAuthHook(apiKeyStore, {
    sessionSecret: config.sessionSecret,
  });



  healthMonitor.start();

  app.addHook("onClose", async () => {

    healthMonitor.stop();

    await closePool();

  });



  app.get("/health", async () => ({

    status: "ok",

    providers: providers.map((provider) => provider.name),

    fallback_chain: getFallbackChain(providers),

    storage: process.env.DATABASE_URL ? "postgres" : "file",

  }));



  await registerAuthRoutes(app, {
    store: apiKeyStore,
    authenticate,
    keyGenRateLimit: createRateLimiter({
      max: config.keyGenRateLimitMax,
      windowMs: config.keyGenRateLimitWindowMs,
    }),
    creditStore,
    usageStore,
    initialCreditBalance: config.initialCreditBalance,
    sessionSecret: config.sessionSecret,
    sessionTtlMs: config.sessionTtlMs,
    clerkSecretKey: config.clerkSecretKey,
  });

  await registerStatusRoutes(app, { providers, healthStore });
  await registerModelsRoutes(app, { providers, healthStore });

  await registerChatRoutes(app, {
    router,
    authenticate,
    usageStore,
    creditStore,
    chatRateLimit: createRateLimiter({
      max: config.chatRateLimitMax,
      windowMs: config.chatRateLimitWindowMs,
    }),
    minChatCost: config.minChatCost,
  });
  await registerUsageRoutes(app, { store: usageStore, apiKeyStore, authenticate });
  await registerBalanceRoutes(app, { creditStore, authenticate });



  return { app, config };

}

