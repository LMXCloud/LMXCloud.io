import Fastify from "fastify";

import cors from "@fastify/cors";

import { createApiKeyStore, createAuthHook } from "./auth/index.js";

import { loadConfig } from "./config.js";

import { HealthMonitor } from "./health/monitor.js";

import { InMemoryHealthStore } from "./health/store.js";

import { createProviderRegistry, getFallbackChain } from "./providers/registry.js";

import { InferenceRouter } from "./routing/router.js";

import { registerAuthRoutes } from "./routes/auth.js";

import { registerChatRoutes } from "./routes/chat.js";

import { registerStatusRoutes } from "./routes/status.js";
import { createRateLimiter } from "./rate-limit.js";



export async function buildServer() {

  const config = loadConfig();



  const app = Fastify({
    trustProxy: true,
    logger: {
      level: process.env.LOG_LEVEL ?? "info",
    },
  });



  await app.register(cors, {
    origin: true,
    exposedHeaders: ["x-lmx-provider", "x-lmx-fallback", "x-lmx-latency"],
  });



  const providers = createProviderRegistry(config);

  const healthStore = new InMemoryHealthStore();

  const healthMonitor = new HealthMonitor(

    providers,

    healthStore,

    config.healthPollIntervalMs,

  );

  const router = new InferenceRouter(providers, healthStore);

  const apiKeyStore = createApiKeyStore();

  const authenticate = createAuthHook(apiKeyStore);



  healthMonitor.start();

  app.addHook("onClose", async () => {

    healthMonitor.stop();

  });



  app.get("/health", async () => ({

    status: "ok",

    providers: providers.map((provider) => provider.name),

    fallback_chain: getFallbackChain(providers),

  }));



  await registerAuthRoutes(app, {
    store: apiKeyStore,
    rateLimit: createRateLimiter({
      max: config.keyGenRateLimitMax,
      windowMs: config.keyGenRateLimitWindowMs,
    }),
  });

  await registerStatusRoutes(app, { providers, healthStore });

  await registerChatRoutes(app, { router, authenticate });



  return { app, config };

}


