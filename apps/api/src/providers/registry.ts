import type { Config } from "../config.js";
import { createAkashAdapter } from "./akash.js";
import { createIonetAdapter } from "./ionet.js";
import { createTogetherAdapter } from "./together.js";
import type { ProviderAdapter } from "./types.js";

export function createProviderRegistry(config: Config): ProviderAdapter[] {
  const providers: ProviderAdapter[] = [createIonetAdapter(config.ionet)];

  if (config.akash) {
    providers.push(createAkashAdapter(config.akash));
  }

  if (config.together) {
    providers.push(createTogetherAdapter(config.together));
  }

  return providers.sort((a, b) => a.tier - b.tier);
}

export function getFallbackChain(providers: ProviderAdapter[]): string[] {
  return providers.map((provider) => provider.name);
}
