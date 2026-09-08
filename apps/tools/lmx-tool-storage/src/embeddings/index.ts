import { LocalEmbeddingProvider } from "./local.js";
import type { EmbeddingProvider } from "./provider.js";

export type { EmbeddingProvider } from "./provider.js";
export { EMBEDDING_DIMENSIONS } from "./provider.js";
export { LOCAL_EMBEDDING_MODEL } from "./local.js";

let provider: EmbeddingProvider | null = null;
let warming: Promise<EmbeddingProvider> | null = null;

export function getEmbeddingProvider(): EmbeddingProvider {
  if (!provider) provider = new LocalEmbeddingProvider();
  return provider;
}

export async function warmEmbeddingProvider(): Promise<EmbeddingProvider> {
  if (!warming) {
    warming = (async () => {
      const current = getEmbeddingProvider();
      console.log(`Loading local embedding model (${current.modelId})...`);
      // Force weights + WASM to load before the first PUT/search.
      await current.embed("");
      console.log("Local embedding model ready");
      return current;
    })();
  }
  return warming;
}
