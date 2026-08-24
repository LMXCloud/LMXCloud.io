import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  OPENAI_PROPRIETARY_MODEL_IDS,
  SUPPORTED_MODELS,
  type DepinProvider,
} from "@lmxcloud/shared";
import {
  AETHIR_MODEL_MAP,
  AKASH_MODEL_MAP,
  IONET_MODEL_MAP,
  NOSANA_MODEL_MAP,
  TOGETHER_MODEL_MAP,
} from "./model-maps.js";

const PROVIDER_MAPS: Record<DepinProvider, Record<string, string>> = {
  ionet: IONET_MODEL_MAP,
  akash: AKASH_MODEL_MAP,
  aethir: AETHIR_MODEL_MAP,
  nosana: NOSANA_MODEL_MAP,
};

describe("model catalog integrity", () => {
  it("does not advertise or remap OpenAI proprietary model IDs", () => {
    const advertised = new Set([
      ...SUPPORTED_MODELS.flatMap((model) => [model.alias, model.upstreamId]),
      ...Object.keys(IONET_MODEL_MAP),
      ...Object.keys(AKASH_MODEL_MAP),
      ...Object.keys(AETHIR_MODEL_MAP),
      ...Object.keys(NOSANA_MODEL_MAP),
      ...Object.keys(TOGETHER_MODEL_MAP),
    ]);

    for (const id of OPENAI_PROPRIETARY_MODEL_IDS) {
      assert.equal(
        advertised.has(id),
        false,
        `${id} must not appear in the public catalog or provider maps (no OpenAI integration)`,
      );
    }
  });

  it("gives every advertised alias at least one real DePIN provider map entry", () => {
    for (const model of SUPPORTED_MODELS) {
      assert.ok(
        model.providers.length > 0,
        `${model.alias} has no providers listed`,
      );

      const mapped = model.providers.filter(
        (provider) => PROVIDER_MAPS[provider][model.alias],
      );
      assert.ok(
        mapped.length > 0,
        `${model.alias} is advertised on [${model.providers.join(", ")}] but missing from those provider maps`,
      );
    }
  });
});
