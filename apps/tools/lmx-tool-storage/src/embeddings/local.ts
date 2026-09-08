import fs from "node:fs";
import path from "node:path";
import { env, pipeline, type FeatureExtractionPipeline } from "@huggingface/transformers";
import { getPackageDir } from "../db/backend.js";
import { EMBEDDING_DIMENSIONS, type EmbeddingProvider } from "./provider.js";

export const LOCAL_EMBEDDING_MODEL = "Xenova/all-MiniLM-L6-v2";

function modelCacheDir(): string {
  return path.join(getPackageDir(), "data", "models");
}

function toFloat32(data: unknown, dimensions: number): Float32Array {
  const raw =
    data instanceof Float32Array
      ? data
      : data instanceof ArrayBuffer
        ? new Float32Array(data)
        : Float32Array.from(data as ArrayLike<number>);
  if (raw.length === dimensions) return raw;
  if (raw.length > dimensions) return raw.slice(0, dimensions);
  throw new Error(`Embedding length ${raw.length} did not match expected ${dimensions}`);
}

export class LocalEmbeddingProvider implements EmbeddingProvider {
  readonly modelId = LOCAL_EMBEDDING_MODEL;
  readonly dimensions = EMBEDDING_DIMENSIONS;

  private extractor: FeatureExtractionPipeline | null = null;

  async embed(text: string): Promise<Float32Array> {
    const extractor = await this.load();
    const output = await extractor(text, { pooling: "mean", normalize: true });
    return toFloat32(output.data, this.dimensions);
  }

  async load(): Promise<FeatureExtractionPipeline> {
    if (this.extractor) return this.extractor;

    const cacheDir = modelCacheDir();
    fs.mkdirSync(cacheDir, { recursive: true });
    env.cacheDir = cacheDir;
    env.allowLocalModels = true;
    env.useFSCache = true;

    // Node builds of transformers.js v4 use onnxruntime-node (cpu/dml/webgpu).
    // WASM is a browser execution provider and is rejected here.
    this.extractor = await pipeline("feature-extraction", LOCAL_EMBEDDING_MODEL, {
      cache_dir: cacheDir,
      device: "cpu",
    });
    return this.extractor;
  }
}
