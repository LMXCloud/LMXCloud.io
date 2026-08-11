import type { Config } from "../../config.js";
import { createIonetBalancePoller } from "./ionet.js";
import { createStaticNotObservablePoller } from "./static.js";
import type { ProviderBalancePoller } from "./types.js";

const DEFAULT_THRESHOLD_USD = 10;

function parseThreshold(envName: string): number {
  const raw = process.env[envName]?.trim();
  if (!raw) return DEFAULT_THRESHOLD_USD;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${envName} must be a non-negative number`);
  }
  return value;
}

export function createProviderBalancePollers(config: Config): ProviderBalancePoller[] {
  const pollers: ProviderBalancePoller[] = [
    createIonetBalancePoller({
      apiKey: config.ionet.apiKey,
      thresholdUsd: parseThreshold("PROVIDER_BALANCE_THRESHOLD_IONET"),
    }),
  ];

  if (config.akash) {
    pollers.push(
      createStaticNotObservablePoller({
        provider: "akash",
        thresholdUsd: parseThreshold("PROVIDER_BALANCE_THRESHOLD_AKASHML"),
      }),
    );
  }

  if (config.aethir) {
    pollers.push(
      createStaticNotObservablePoller({
        provider: "aethir",
        thresholdUsd: parseThreshold("PROVIDER_BALANCE_THRESHOLD_AETHIR"),
      }),
    );
  }

  return pollers;
}
