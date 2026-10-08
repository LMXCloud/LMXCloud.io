import assert from "node:assert/strict";
import { afterEach, describe, it, mock } from "node:test";
import type { ChatCompletionRequest } from "@lmxcloud/shared";
import { InMemoryHealthStore } from "../health/store.js";
import { expectedProviderModelId } from "../providers/model-maps.js";
import { ProviderError, type ProviderAdapter } from "../providers/types.js";
import { parseRoutingPreference } from "./strategies.js";
import {
  InferenceRouter,
  StreamingTemporarilyUnavailableError,
  logModelSubstitution,
  observeStreamedModel,
} from "./router.js";

describe("logModelSubstitution", () => {
  afterEach(() => {
    mock.restoreAll();
  });

  it("logs when the provider returns a different model than the one it was asked to run", () => {
    const lines: string[] = [];
    mock.method(console, "info", (...args: unknown[]) => {
      lines.push(String(args[0]));
    });

    logModelSubstitution("ionet", "qwen-3.6-35b", "some-other-model");

    assert.equal(lines.length, 1);
    assert.deepEqual(JSON.parse(lines[0]!), {
      msg: "model_substitution",
      provider: "ionet",
      requested: "qwen-3.6-35b",
      expected: "Qwen/Qwen3.6-35B-A3B",
      returned: "some-other-model",
    });
  });

  it("stays quiet when the returned model is the provider's real model id", () => {
    const lines: string[] = [];
    mock.method(console, "info", (...args: unknown[]) => {
      lines.push(String(args[0]));
    });

    logModelSubstitution("ionet", "qwen-3.6-35b", "Qwen/Qwen3.6-35B-A3B");
    logModelSubstitution("aethir", "qwen-3.6-35b", "qwen3.6-35b-a3b");
    logModelSubstitution("akash", "llama-3-70b", "meta-llama/Llama-3.3-70B-Instruct");

    assert.deepEqual(lines, []);
  });
});

describe("observeStreamedModel", () => {
  afterEach(() => {
    mock.restoreAll();
  });

  it("logs the first substituted chunk once, with a streaming flag", () => {
    const lines: string[] = [];
    mock.method(console, "info", (...args: unknown[]) => {
      lines.push(String(args[0]));
    });

    const state = { noted: false };
    observeStreamedModel("akash", "qwen-3.5-35b", undefined, state);
    observeStreamedModel("akash", "qwen-3.5-35b", "Qwen/Qwen3.6-35B-A3B", state);
    observeStreamedModel("akash", "qwen-3.5-35b", "Qwen/Qwen3.6-35B-A3B", state);

    assert.equal(state.noted, true);
    assert.equal(lines.length, 1);
    assert.deepEqual(JSON.parse(lines[0]!), {
      msg: "model_substitution",
      provider: "akash",
      requested: "qwen-3.5-35b",
      expected: "Qwen/Qwen3.5-35B-A3B",
      returned: "Qwen/Qwen3.6-35B-A3B",
      streaming: true,
    });
  });

  it("stays quiet when the streamed model matches the upstream id", () => {
    const lines: string[] = [];
    mock.method(console, "info", (...args: unknown[]) => {
      lines.push(String(args[0]));
    });

    const state = { noted: false };
    observeStreamedModel("nosana", "qwen-3.5-35b", "Qwen/Qwen3.5-35B-A3B", state);
    observeStreamedModel("nosana", "qwen-3.5-35b", "Qwen/Qwen3.6-35B-A3B", state);

    assert.equal(state.noted, true);
    assert.deepEqual(lines, []);
  });
});

describe("known-bad streamed routes", () => {
  function request(model: string, stream?: boolean): ChatCompletionRequest {
    return {
      model,
      messages: [{ role: "user", content: "hi" }],
      ...(stream === undefined ? {} : { stream }),
    };
  }

  function provider(
    name: string,
    aliases: string[],
    calls: Array<{ name: string; model: string; stream?: boolean }>,
    options?: { fail?: boolean },
  ): ProviderAdapter {
    return {
      name,
      tier: 1,
      costPer1kTokens: 0.001,
      isDepin: true,
      aliases,
      supportsModel: (model) => aliases.includes(model),
      chatCompletion: async (body) => {
        calls.push({ name, model: body.model, stream: body.stream });
        if (options?.fail) {
          throw new ProviderError(`${name} down`, name, 503);
        }
        return {
          response: {
            id: "chatcmpl_test",
            object: "chat.completion",
            created: 0,
            model: expectedProviderModelId(name, body.model) ?? body.model,
            choices: [
              {
                index: 0,
                finish_reason: "stop",
                message: { role: "assistant", content: "ok" },
              },
            ],
          },
          latencyMs: 1,
          usage: null,
        };
      },
      healthCheck: async () => ({ healthy: true, latencyMs: 1 }),
    };
  }

  function router(providers: ProviderAdapter[]): InferenceRouter {
    const health = new InMemoryHealthStore();
    for (const candidate of providers) {
      health.set(candidate.name, { healthy: true, latencyMs: 1, lastCheck: 1 });
    }
    return new InferenceRouter(providers, health);
  }

  it("does not send streamed qwen-3.5-35b to akash, even when x-lmx-prefer asks for akash", async () => {
    const calls: Array<{ name: string; model: string; stream?: boolean }> = [];
    const selected = await router([
      provider("nosana", ["qwen-3.5-35b"], calls),
      provider("akash", ["qwen-3.5-35b", "llama-3-70b"], calls),
    ]).route(
      request("qwen-3.5-35b", true),
      parseRoutingPreference("provider:akash"),
    );

    assert.equal(selected.provider, "nosana");
    assert.deepEqual(calls, [{ name: "nosana", model: "qwen-3.5-35b", stream: true }]);
  });

  it("does not fall back to akash when the other streamed provider fails", async () => {
    const calls: Array<{ name: string; model: string; stream?: boolean }> = [];
    await assert.rejects(
      () =>
        router([
          provider("nosana", ["qwen-3.5-35b"], calls, { fail: true }),
          provider("akash", ["qwen-3.5-35b"], calls),
        ]).route(request("qwen-3.5-35b", true), { strategy: "default" }),
      (err: unknown) => err instanceof ProviderError && err.provider === "nosana",
    );
    assert.deepEqual(calls, [{ name: "nosana", model: "qwen-3.5-35b", stream: true }]);
  });

  it("returns a client error when streamed qwen-3.5-35b has no provider left", async () => {
    const calls: Array<{ name: string; model: string; stream?: boolean }> = [];
    await assert.rejects(
      () =>
        router([provider("akash", ["qwen-3.5-35b", "llama-3-70b"], calls)]).route(
          request("qwen-3.5-35b", true),
          parseRoutingPreference("provider:akash"),
        ),
      (err: unknown) => {
        assert.ok(err instanceof StreamingTemporarilyUnavailableError);
        assert.equal(err.statusCode, 503);
        assert.equal(err.model, "qwen-3.5-35b");
        assert.match(err.message, /temporarily unavailable for streaming/);
        assert.match(err.message, /stream:false/);
        return true;
      },
    );
    assert.deepEqual(calls, []);
  });

  it("still sends non-streaming qwen-3.5-35b to akash", async () => {
    const calls: Array<{ name: string; model: string; stream?: boolean }> = [];
    const routed = router([
      provider("akash", ["qwen-3.5-35b"], calls),
      provider("nosana", ["qwen-3.5-35b"], calls),
    ]);
    const selected = await routed.route(
      request("qwen-3.5-35b", false),
      parseRoutingPreference("provider:akash"),
    );
    const omitted = await routed.route(request("qwen-3.5-35b"), { strategy: "default" });

    assert.equal(selected.provider, "akash");
    assert.equal(omitted.provider, "akash");
    assert.deepEqual(calls, [
      { name: "akash", model: "qwen-3.5-35b", stream: false },
      { name: "akash", model: "qwen-3.5-35b", stream: undefined },
    ]);
  });

  it("still sends other streamed models to akash", async () => {
    const calls: Array<{ name: string; model: string; stream?: boolean }> = [];
    const selected = await router([
      provider("akash", ["qwen-3.5-35b", "llama-3-70b"], calls),
    ]).route(request("llama-3-70b", true), { strategy: "default" });

    assert.equal(selected.provider, "akash");
    assert.deepEqual(calls, [{ name: "akash", model: "llama-3-70b", stream: true }]);
  });
});
