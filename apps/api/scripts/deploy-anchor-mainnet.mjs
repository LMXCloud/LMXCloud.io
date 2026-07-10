#!/usr/bin/env node
/**
 * Deploy LmxLogAnchor to Base mainnet — gated; not used in production today.
 *
 * Production intentionally leaves ANCHOR_* unset (receipt-only mode).
 * Local full verify uses Base Sepolia: pnpm deploy:anchor
 *
 * To run: ALLOW_MAINNET_ANCHOR_DEPLOY=true pnpm deploy:anchor:mainnet
 */
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { spawn } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
dotenv.config({ path: path.join(root, ".env.mainnet") });
dotenv.config({ path: path.join(root, ".env") });

if (process.env.ALLOW_MAINNET_ANCHOR_DEPLOY !== "true") {
  console.error(
    "Mainnet anchor deploy is disabled by default.\n" +
      "Production uses receipt-only mode (no ANCHOR_* on Railway).\n" +
      "For local verify, use Base Sepolia: pnpm deploy:anchor\n" +
      "To force mainnet deploy: ALLOW_MAINNET_ANCHOR_DEPLOY=true pnpm deploy:anchor:mainnet",
  );
  process.exit(1);
}

process.env.SIWE_CHAIN_ID = "8453";

if (!process.env.ANCHOR_PRIVATE_KEY) {
  console.error("Set ANCHOR_PRIVATE_KEY to a funded Base mainnet deployer wallet");
  process.exit(1);
}

if (!process.env.BASE_RPC_URL) {
  console.error("Set BASE_RPC_URL in .env.mainnet");
  process.exit(1);
}

const child = spawn("node", ["scripts/deploy-anchor.mjs"], {
  cwd: path.join(root, "apps/api"),
  env: process.env,
  stdio: "inherit",
});

child.on("exit", (code) => process.exit(code ?? 1));
