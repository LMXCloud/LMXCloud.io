import assert from "node:assert/strict";
import { afterEach, describe, it, mock } from "node:test";
import type { ChatCompletionRequest } from "@lmxcloud/shared";
import { InMemoryHealthStore } from "../health/store.js";
import { createOpenAiCompatibleAdapter } from "../providers/openai-compatible.js";
import type { ProviderAdapter } from "../providers/types.js";
import {
  InferenceRouter,
  logModelSubstitution,
  observeStreamedModel,
  selectExecutedModel,
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
      source: "body",
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
    observeStreamedModel("akash", "qwen-3.6-35b", undefined, state);
    observeStreamedModel("akash", "qwen-3.6-35b", "some-other-model", state);
    observeStreamedModel("akash", "qwen-3.6-35b", "some-other-model", state);

    assert.equal(state.noted, true);
    assert.equal(lines.length, 1);
    assert.deepEqual(JSON.parse(lines[0]!), {
      msg: "model_substitution",
      provider: "akash",
      requested: "qwen-3.6-35b",
      expected: "Qwen/Qwen3.6-35B-A3B",
      returned: "some-other-model",
      source: "body",
      streaming: true,
    });
  });

  it("stays quiet when the streamed model matches the upstream id", () => {
    const lines: string[] = [];
    mock.method(console, "info", (...args: unknown[]) => {
      lines.push(String(args[0]));
    });

    const state = { noted: false };
    observeStreamedModel("akash", "qwen-3.6-35b", "Qwen/Qwen3.6-35B-A3B", state);
    observeStreamedModel("akash", "qwen-3.6-35b", "some-other-model", state);

    assert.equal(state.noted, true);
    assert.deepEqual(lines, []);
  });
});

describe("selectExecutedModel", () => {
  it("prefers a non-empty X-Model-Executed value over the body model", () => {
    assert.deepEqual(
      selectExecutedModel(" Qwen/Qwen3.6-35B-A3B ", "Qwen/Qwen3.5-35B-A3B"),
      { id: "Qwen/Qwen3.6-35B-A3B", source: "header" },
    );
  });

  it("uses the body model when the header is missing or blank", () => {
    assert.deepEqual(selectExecutedModel(undefined, "Qwen/Qwen3.6-35B-A3B"), {
      id: "Qwen/Qwen3.6-35B-A3B",
      source: "body",
    });
    assert.deepEqual(selectExecutedModel("  ", "Qwen/Qwen3.6-35B-A3B"), {
      id: "Qwen/Qwen3.6-35B-A3B",
      source: "body",
    });
    assert.equal(selectExecutedModel(null, "  "), undefined);
  });
});

describe("executed-model header on the routed response", () => {
  function request(model: string, stream?: boolean): ChatCompletionRequest {
    return {
      model,
      messages: [{ role: "user", content: "hi" }],
      ...(stream === undefined ? {} : { stream }),
    };
  }

  function provider(
    responseModel: string,
    executedModel?: { id: string; source: "header" | "body" },
  ): ProviderAdapter {
    return {
      name: "akash",
      tier: 1,
      costPer1kTokens: 0.001,
      isDepin: true,
      aliases: ["qwen-3.6-35b", "llama-3-70b"],
      supportsModel: (model) => model === "qwen-3.6-35b" || model === "llama-3-70b",
      chatCompletion: async () => ({
        response: {
          id: "chatcmpl_test",
          object: "chat.completion",
          created: 0,
          model: responseModel,
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
        ...(executedModel ? { executedModel } : {}),
      }),
      healthCheck: async () => ({ healthy: true, latencyMs: 1 }),
    };
  }

  function router(candidate: ProviderAdapter): InferenceRouter {
    const health = new InMemoryHealthStore();
    health.set(candidate.name, { healthy: true, latencyMs: 1, lastCheck: 1 });
    return new InferenceRouter([candidate], health);
  }

  afterEach(() => {
    mock.restoreAll();
  });

  it("logs the header model when the body model matches the expected id", async () => {
    const lines: string[] = [];
    mock.method(console, "info", (...args: unknown[]) => {
      lines.push(String(args[0]));
    });

    const routed = await router(
      provider("Qwen/Qwen3.6-35B-A3B", {
        id: "other-executed-model",
        source: "header",
      }),
    ).route(request("qwen-3.6-35b", false), { strategy: "default" });

    assert.equal(routed.response.model, "Qwen/Qwen3.6-35B-A3B");
    assert.equal(lines.length, 1);
    assert.deepEqual(JSON.parse(lines[0]!), {
      msg: "model_substitution",
      provider: "akash",
      requested: "qwen-3.6-35b",
      expected: "Qwen/Qwen3.6-35B-A3B",
      returned: "other-executed-model",
      source: "header",
    });
  });

  it("stays quiet when the header matches even if the body model does not", async () => {
    const lines: string[] = [];
    mock.method(console, "info", (...args: unknown[]) => {
      lines.push(String(args[0]));
    });

    const routed = await router(
      provider("Qwen/Qwen3.5-35B-A3B", {
        id: "Qwen/Qwen3.6-35B-A3B",
        source: "header",
      }),
    ).route(request("qwen-3.6-35b"), { strategy: "default" });

    assert.equal(routed.response.model, "Qwen/Qwen3.5-35B-A3B");
    assert.deepEqual(lines, []);
  });

  it("keeps logging the body model for providers that do not send the header", async () => {
    const lines: string[] = [];
    mock.method(console, "info", (...args: unknown[]) => {
      lines.push(String(args[0]));
    });

    await router(provider("some-other-model")).route(request("llama-3-70b", false), {
      strategy: "default",
    });

    assert.equal(lines.length, 1);
    assert.deepEqual(JSON.parse(lines[0]!), {
      msg: "model_substitution",
      provider: "akash",
      requested: "llama-3-70b",
      expected: "meta-llama/Llama-3.3-70B-Instruct",
      returned: "some-other-model",
      source: "body",
    });
  });
});

describe("non-streaming header from the provider response", () => {
  afterEach(() => {
    mock.restoreAll();
  });

  it("logs X-Model-Executed and leaves the mislabeled body model unchanged", async () => {
    const lines: string[] = [];
    mock.method(console, "info", (...args: unknown[]) => {
      lines.push(String(args[0]));
    });
    mock.method(globalThis, "fetch", async () =>
      new Response(
        JSON.stringify({
          id: "chatcmpl_test",
          object: "chat.completion",
          created: 0,
          model: "Qwen/Qwen3.5-35B-A3B",
          choices: [
            {
              index: 0,
              finish_reason: "stop",
              message: { role: "assistant", content: "ok" },
            },
          ],
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json",
            "x-model-executed": "other-executed-model",
          },
        },
      ),
    );

    const akash = createOpenAiCompatibleAdapter({
      name: "akash",
      tier: 1,
      costPer1kTokens: 0.001,
      isDepin: true,
      apiKey: "test",
      baseUrl: "https://akash.test/v1",
      resolveModel: () => "Qwen/Qwen3.6-35B-A3B",
      aliases: ["qwen-3.6-35b"],
    });
    const health = new InMemoryHealthStore();
    health.set("akash", { healthy: true, latencyMs: 1, lastCheck: 1 });
    const routed = await new InferenceRouter([akash], health).route(
      {
        model: "qwen-3.6-35b",
        messages: [{ role: "user", content: "hi" }],
      },
      { strategy: "default" },
    );

    assert.equal(routed.response.model, "Qwen/Qwen3.5-35B-A3B");
    const substitutions = lines
      .map((line) => JSON.parse(line) as { msg?: string })
      .filter((entry) => entry.msg === "model_substitution");
    assert.deepEqual(substitutions, [
      {
        msg: "model_substitution",
        provider: "akash",
        requested: "qwen-3.6-35b",
        expected: "Qwen/Qwen3.6-35B-A3B",
        returned: "other-executed-model",
        source: "header",
      },
    ]);
  });
});
