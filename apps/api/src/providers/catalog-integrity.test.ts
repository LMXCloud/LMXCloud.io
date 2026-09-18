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

  it("gives every advertised alias a real map entry on each listed DePIN provider", () => {
    const missing: string[] = [];

    for (const model of SUPPORTED_MODELS) {
      assert.ok(
        model.providers.length > 0,
        `${model.alias} has no providers listed`,
      );

      for (const provider of model.providers) {
        if (!PROVIDER_MAPS[provider][model.alias]) {
          missing.push(
            `${model.alias} listed on ${provider} but missing from ${provider} map`,
          );
        }
      }
    }

    assert.deepEqual(missing, [], missing.join("\n"));
  });

  it("does not leave provider-map keys that cannot resolve to a supported model", () => {
    const knownIds = new Set(
      SUPPORTED_MODELS.flatMap((model) => [model.alias, model.upstreamId]),
    );
    const orphanKeys: string[] = [];

    for (const [provider, map] of Object.entries(PROVIDER_MAPS) as Array<
      [DepinProvider, Record<string, string>]
    >) {
      const supportedUpstreams = new Set(
        SUPPORTED_MODELS.filter((model) => model.providers.includes(provider)).map(
          (model) => map[model.alias],
        ),
      );

      for (const [key, upstream] of Object.entries(map)) {
        if (!upstream) {
          orphanKeys.push(`${provider}:${key} maps to an empty upstream id`);
          continue;
        }
        if (knownIds.has(key) || supportedUpstreams.has(upstream)) continue;
        orphanKeys.push(
          `${provider}:${key} → ${upstream} has no matching SUPPORTED_MODELS alias`,
        );
      }
    }

    assert.deepEqual(orphanKeys, [], orphanKeys.join("\n"));
  });
});
