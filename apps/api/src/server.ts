import Fastify from "fastify";
import cors from "@fastify/cors";
import * as Sentry from "@sentry/node";
import { getAddress } from "viem";
import { createApiKeyStore, createAuthHook } from "./auth/index.js";
import { createOptionalAuthHook } from "./auth/optional-auth.js";
import { createWalletNonceStore } from "./auth/wallet-nonce.js";
import { loadConfig } from "./config.js";
import { closePool } from "./db/pool.js";
import { DepositPoller } from "./deposits/poller.js";
import { MIN_DEPOSIT_USDC } from "./deposits/limits.js";
import { createDepositStore } from "./deposits/store.js";
import { AnchorPoller } from "./anchors/poller.js";
import { createAnchorStore } from "./anchors/store.js";
import { HealthMonitor } from "./health/monitor.js";
import { InMemoryHealthStore } from "./health/store.js";
import { createProviderRegistry, getFallbackChain } from "./providers/registry.js";
import { InferenceRouter } from "./routing/router.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerChatRoutes } from "./routes/chat.js";
import { registerWebSearchRoutes } from "./routes/web-search.js";
import { registerModelsRoutes } from "./routes/models.js";
import { registerStatusRoutes } from "./routes/status.js";
import { registerUsageRoutes } from "./routes/usage.js";
import { registerBalanceRoutes } from "./routes/balance.js";
import { registerPaymentRoutes } from "./routes/payments.js";
import { registerPricingRoutes } from "./routes/pricing.js";
import { registerOpsRoutes } from "./routes/ops.js";
import { createPaymentStore } from "./payments/store.js";
import { registerX402ChatPayments } from "./payments/x402-server.js";
import type { Network } from "@x402/core/types";
import { createRateLimiter } from "./rate-limit.js";
import { createUsageStore } from "./usage/index.js";
import { createCreditStore } from "./credits/index.js";
import { createOriginLockHook } from "./origin-lock.js";



export async function buildServer() {

  const config = loadConfig();

  const app = Fastify({

    trustProxy: true,

    logger: {

      level: process.env.LOG_LEVEL ?? "info",

    },

  });

  if (process.env.SENTRY_DSN) {
    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      tracesSampleRate: 0.1,
    });
  } else {
    app.log.warn("SENTRY_DSN is not set — errors will not be reported to Sentry");
  }

  if (!config.clerkSecretKey) {
    app.log.warn("CLERK_SECRET_KEY is not set — POST /v1/auth/clerk will return 503");
  }

  const originLock = createOriginLockHook();
  if (originLock) {
    app.addHook("onRequest", originLock);
    app.log.info("Cloudflare origin lock enabled (LMX_ORIGIN_SECRET)");
  }

  await app.register(cors, {

    origin: true,

    exposedHeaders: [
      "x-lmx-provider",
      "x-lmx-fallback",
      "x-lmx-latency",
      "x-lmx-cost",
      "x-lmx-usage-id",
      "x-lmx-balance",
      "payment-required",
      "payment-response",
      "x-payment-required",
      "x-payment-response",
    ],

  });

  app.setErrorHandler((error, request, reply) => {
    if (process.env.SENTRY_DSN) {
      Sentry.captureException(error);
    }
    request.log.error({ err: error }, "Unhandled error");
    if (!reply.sent) {
      void reply.status(500).send({
        error: {
          message: "Internal server error",
          type: "internal_error",
        },
      });
    }
  });



  const providers = createProviderRegistry(config);

  const healthStore = new InMemoryHealthStore();

  const healthMonitor = new HealthMonitor(

    providers,

    healthStore,

    config.healthPollIntervalMs,

  );

  const apiKeyStore = await createApiKeyStore();

  const usageStore = createUsageStore();

  const router = new InferenceRouter(providers, healthStore, usageStore);

  const creditStore = createCreditStore();

  const paymentStore = createPaymentStore();
  if (!paymentStore && process.env.X402_ENABLED === "true") {
    app.log.warn(
      "X402_ENABLED is true but payment store is disabled — requires DATABASE_URL",
    );
  }

  const walletNonceStore = createWalletNonceStore();

  const authenticate = createAuthHook(apiKeyStore, {
    sessionSecret: config.sessionSecret,
  });

  const optionalAuth = createOptionalAuthHook(apiKeyStore, {
    sessionSecret: config.sessionSecret,
  });
  app.addHook("onRequest", optionalAuth);

  if (
    config.x402.enabled &&
    config.x402.payToAddress &&
    paymentStore
  ) {
    registerX402ChatPayments({
      app,
      providers,
      healthStore,
      paymentStore,
      payToAddress: getAddress(config.x402.payToAddress),
      networkId: config.x402.networkId as Network,
      cdpApiKeyId: config.x402.cdpApiKeyId,
      cdpApiKeySecret: config.x402.cdpApiKeySecret,
      marginPct: config.x402.marginPct,
      minCallUsdc: config.x402.minCallUsdc,
      defaultMaxCompletionTokens: config.x402.defaultMaxCompletionTokens,
    });
    app.log.info("x402 per-call payments enabled on POST /v1/chat/completions");
  } else if (config.x402.enabled) {
    app.log.warn(
      "X402_ENABLED is true but x402 middleware is disabled — requires DATABASE_URL and TREASURY_ADDRESS",
    );
  }

  let depositPoller: DepositPoller | null = null;
  const depositStore = createDepositStore();
  if (config.deposits && depositStore) {
    depositPoller = new DepositPoller(
      {
        rpcUrl: config.deposits.rpcUrl,
        treasuryAddress: getAddress(config.deposits.treasuryAddress),
        usdcContractAddress: getAddress(config.deposits.usdcContractAddress),
        chainId: config.deposits.chainId,
        confirmations: config.deposits.confirmations,
        pollIntervalMs: config.deposits.pollIntervalMs,
        lookbackBlocks: config.deposits.lookbackBlocks,
        maxLogBlockRange: config.deposits.maxLogBlockRange,
        maxDepositUsdc: config.deposits.maxDepositUsdc,
      },
      depositStore,
      apiKeyStore,
      (message) => app.log.info(message),
    );
    depositPoller.start();
  } else if (process.env.TREASURY_ADDRESS || process.env.BASE_RPC_URL) {
    app.log.warn(
      "Deposit poller disabled — requires DATABASE_URL, BASE_RPC_URL, and TREASURY_ADDRESS",
    );
  }

  let anchorPoller: AnchorPoller | null = null;
  const anchorStore = createAnchorStore();
  if (config.anchoring && anchorStore) {
    anchorPoller = new AnchorPoller(
      {
        rpcUrl: config.anchoring.rpcUrl,
        chainId: config.anchoring.chainId,
        contractAddress: config.anchoring.contractAddress,
        privateKey: config.anchoring.privateKey,
        pollIntervalMs: config.anchoring.pollIntervalMs,
        minEvents: config.anchoring.minEvents,
        maxEvents: config.anchoring.maxEvents,
      },
      anchorStore,
      (message) => app.log.info(message),
    );
    anchorPoller.start();
  } else if (
    process.env.ANCHOR_CONTRACT_ADDRESS ||
    process.env.ANCHOR_PRIVATE_KEY
  ) {
    app.log.warn(
      "Anchor poller disabled — requires DATABASE_URL, BASE_RPC_URL, ANCHOR_CONTRACT_ADDRESS, and ANCHOR_PRIVATE_KEY",
    );
  }



  healthMonitor.start();

  app.addHook("onClose", async () => {

    healthMonitor.stop();

    depositPoller?.stop();

    anchorPoller?.stop();

    await closePool();

  });



  app.get("/health", async () => ({

    status: "ok",

    providers: providers.map((provider) => provider.name),

    fallback_chain: getFallbackChain(providers),

    storage: process.env.DATABASE_URL ? "postgres" : "file",

    x402_payments: paymentStore ? "ready" : "disabled",
    x402_enabled: config.x402.enabled,

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
    walletNonceStore,
    siwe: config.siwe,
  });

  await registerStatusRoutes(app, {
    providers,
    healthStore,
    anchorStore,
    anchoring: config.anchoring
      ? {
          chainId: config.anchoring.chainId,
          contractAddress: config.anchoring.contractAddress,
        }
      : undefined,
  });
  await registerModelsRoutes(app, { providers, healthStore });
  await registerPricingRoutes(app, {
    providers,
    healthStore,
    chainId: config.siwe.chainId,
    webSearchPriceUsdc: config.webSearchPriceUsdc,
    webSearchConfigured: Boolean(config.braveSearch),
  });

  await registerChatRoutes(app, {
    router,
    usageStore,
    creditStore,
    paymentStore,
    chatRateLimit: createRateLimiter({
      max: config.chatRateLimitMax,
      windowMs: config.chatRateLimitWindowMs,
    }),
    x402RateLimit: createRateLimiter({
      max: Number(process.env.X402_ANON_RATE_LIMIT_MAX ?? process.env.X402_RATE_LIMIT_MAX ?? 10),
      windowMs: Number(
        process.env.X402_ANON_RATE_LIMIT_WINDOW_MS ??
          process.env.X402_RATE_LIMIT_WINDOW_MS ??
          60_000,
      ),
    }),
    minChatCost: config.minChatCost,
    x402Enabled: config.x402.enabled && Boolean(config.x402.payToAddress && paymentStore),
  });
  await registerWebSearchRoutes(app, {
    brave: config.braveSearch ?? null,
    usageStore,
    creditStore,
    priceUsdc: config.webSearchPriceUsdc,
    rateLimit: createRateLimiter({
      max: config.webSearchRateLimitMax,
      windowMs: config.webSearchRateLimitWindowMs,
    }),
  });
  await registerUsageRoutes(app, {
    store: usageStore,
    apiKeyStore,
    authenticate,
    anchorStore,
    anchorContractAddress: config.anchoring?.contractAddress,
  });
  await registerBalanceRoutes(app, {
    creditStore,
    authenticate,
    depositStore,
    depositInfo: config.deposits
      ? {
          treasuryAddress: getAddress(config.deposits.treasuryAddress),
          usdcContractAddress: getAddress(config.deposits.usdcContractAddress),
          chain: config.deposits.chainLabel,
          chainId: config.deposits.chainId,
          token: "USDC",
          confirmations: config.deposits.confirmations,
          minDepositUsdc: MIN_DEPOSIT_USDC,
          maxDepositUsdc: config.deposits.maxDepositUsdc,
        }
      : undefined,
  });
  await registerPaymentRoutes(app, {
    paymentStore,
    apiKeyStore,
    authenticate,
    x402Enabled:
      config.x402.enabled && Boolean(config.x402.payToAddress && paymentStore),
  });

  await registerOpsRoutes(app, {
    providers,
    healthStore,
    x402Enabled:
      config.x402.enabled && Boolean(config.x402.payToAddress && paymentStore),
    paymentStoreReady: Boolean(paymentStore),
  });

  return { app, config };

}

