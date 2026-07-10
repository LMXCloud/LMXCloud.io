#!/usr/bin/env node
/**
 * Deploy LmxLogAnchor to Base mainnet using .env.mainnet + deployer key from .env.
 */
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { spawn } from "node:child_process";
import { createPublicClient, formatEther, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
dotenv.config({ path: path.join(root, ".env.mainnet") });
dotenv.config({ path: path.join(root, ".env") });

process.env.SIWE_CHAIN_ID = "8453";

if (!process.env.BASE_RPC_URL) {
  console.error("Set BASE_RPC_URL in .env.mainnet");
  process.exit(1);
}

function normalizeKey(raw) {
  const trimmed = raw.trim();
  return trimmed.startsWith("0x") ? trimmed : `0x${trimmed}`;
}

async function balanceEth(address) {
  const client = createPublicClient({
    chain: base,
    transport: http(process.env.BASE_RPC_URL),
  });
  return client.getBalance({ address });
}

async function resolveDeployerKey() {
  const candidates = [
    { label: "ANCHOR_PRIVATE_KEY", key: process.env.ANCHOR_PRIVATE_KEY },
    { label: "PAYER_PRIVATE_KEY", key: process.env.PAYER_PRIVATE_KEY },
  ];

  for (const candidate of candidates) {
    if (!candidate.key) continue;
    const key = normalizeKey(candidate.key);
    const address = privateKeyToAccount(key).address;
    const balance = await balanceEth(address);
    if (balance > 0n) {
      if (candidate.label !== "ANCHOR_PRIVATE_KEY") {
        console.error(
          `Using ${candidate.label} (${address}) — ${formatEther(balance)} ETH on Base mainnet`,
        );
      }
      return key;
    }
    console.error(`${candidate.label} wallet ${address} has 0 ETH on Base mainnet`);
  }

  console.error(
    "Fund a deployer wallet on Base mainnet (~0.001 ETH is enough), then set ANCHOR_PRIVATE_KEY or PAYER_PRIVATE_KEY",
  );
  process.exit(1);
}

const deployerKey = await resolveDeployerKey();
process.env.ANCHOR_PRIVATE_KEY = deployerKey;

const child = spawn("node", ["scripts/deploy-anchor.mjs"], {
  cwd: path.join(root, "apps/api"),
  env: process.env,
  stdio: "inherit",
});

child.on("exit", (code) => process.exit(code ?? 1));
