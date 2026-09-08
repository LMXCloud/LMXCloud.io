import { GridConsolidationProvider } from "./grid.js";
import type { ConsolidationProvider } from "./provider.js";

export type {
  ConsolidationCluster,
  ConsolidationInput,
  ConsolidationNote,
  ConsolidationOutput,
  ConsolidationProvider,
} from "./provider.js";
export {
  ConsolidationConfigError,
  DEFAULT_LMX_API_URL,
  DEFAULT_LMX_MODEL,
  getGridConfig,
} from "./grid.js";

let provider: ConsolidationProvider | null = null;

export function getConsolidationProvider(): ConsolidationProvider {
  if (!provider) provider = new GridConsolidationProvider();
  return provider;
}
