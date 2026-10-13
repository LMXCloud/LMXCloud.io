import assert from "node:assert/strict";
import { afterEach, describe, it, mock } from "node:test";
import {
  MODEL_ALIASES,
  SUPPORTED_MODELS,
  listUniqueModelAliases,
  resolveModelAlias,
  type ChatCompletionRequest,
} from "@lmxcloud/shared";
import { InMemoryHealthStore } from "../health/store.js";
import { InvalidChatRequestError } from "../payments/quote-errors.js";
import { parseChatBody } from "../payments/quote-context.js";
import { createAkashAdapter } from "../providers/akash.js";
import {
  AETHIR_MODEL_MAP,
  AKASH_MODEL_MAP,
  IONET_MODEL_MAP,
  NOSANA_MODEL_MAP,
  expectedProviderModelId,
} from "../providers/model-maps.js";
import { ModelNotSupportedError, type ProviderAdapter } from "../providers/types.js";
import { InferenceRouter } from "./router.js";
import { parseRoutingPreference } from "./strategies.js";

const QWEN36 = "qwen-3.6-35b";
const QWEN36_UPSTREAM = "Qwen/Qwen3.6-35B-A3B";

describe("qwen-3.5-35b alias", () => {
  it("is not a catalog model and resolves to qwen-3.6-35b", () => {
    assert.equal(
      SUPPORTED_MODELS.some(
        (model) =>
          model.alias === "qwen-3.5-35b" ||
          model.upstreamId === "Qwen/Qwen3.5-35B-A3B",
      ),
      false,
    );
    assert.equal(
      listUniqueModelAliases().some((model) => model.alias === "qwen-3.5-35b"),
      false,
    );
    assert.equal(resolveModelAlias("qwen-3.5-35b"), QWEN36);
    assert.equal(resolveModelAlias("Qwen/Qwen3.5-35B-A3B"), QWEN36);
    assert.equal(resolveModelAlias("Qwen3.5-35B-A3B"), QWEN36);
    assert.equal(resolveModelAlias(QWEN36), QWEN36);
    assert.equal(resolveModelAlias("llama-3-70b"), "llama-3-70b");

    const qwen36 = SUPPORTED_MODELS.find((model) => model.alias === QWEN36);
    assert.deepEqual(qwen36?.providers, ["ionet", "akash", "aethir", "nosana"]);
    assert.equal(qwen36?.upstreamId, QWEN36_UPSTREAM);
  });

  it("leaves every other provider map entry alone", () => {
    assert.equal(AKASH_MODEL_MAP["qwen-3.5-35b"], undefined);
    assert.equal(AKASH_MODEL_MAP[QWEN36], QWEN36_UPSTREAM);
    assert.equal(AKASH_MODEL_MAP["llama-3-70b"], "meta-llama/Llama-3.3-70B-Instruct");
    assert.equal(IONET_MODEL_MAP[QWEN36], QWEN36_UPSTREAM);
    assert.equal(IONET_MODEL_MAP["llama-3-70b"], "meta-llama/Llama-3.3-70B-Instruct");
    assert.equal(AETHIR_MODEL_MAP[QWEN36], "qwen3.6-35b-a3b");
    assert.equal(NOSANA_MODEL_MAP[QWEN36], QWEN36_UPSTREAM);
    assert.equal(NOSANA_MODEL_MAP["qwen-3.5-35b"], undefined);
    assert.equal(expectedProviderModelId("akash", "llama-3-70b"), "meta-llama/Llama-3.3-70B-Instruct");
    assert.equal(expectedProviderModelId("aethir", QWEN36), "qwen3.6-35b-a3b");
  });

  it("parses a qwen-3.5-35b request as qwen-3.6-35b, including vision", () => {
    const text = parseChatBody({
      model: "qwen-3.5-35b",
      messages: [{ role: "user", content: "hi" }],
    });
    assert.ok(!(text instanceof InvalidChatRequestError));
    assert.equal(text.model, QWEN36);

    const upstream = parseChatBody({
      model: "Qwen/Qwen3.5-35B-A3B",
      messages: [{ role: "user", content: "hi" }],
      stream: true,
    });
    assert.ok(!(upstream instanceof InvalidChatRequestError));
    assert.equal(upstream.model, QWEN36);
    assert.equal(upstream.stream, true);

    const vision = parseChatBody({
      model: "qwen-3.5-35b",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "What is this?" },
            { type: "image_url", image_url: { url: "https://example.com/cat.png" } },
          ],
        },
      ],
    });
    assert.ok(!(vision instanceof InvalidChatRequestError));
    assert.equal(vision.model, QWEN36);

    const other = parseChatBody({
      model: "llama-3-70b",
      messages: [{ role: "user", content: "hi" }],
    });
    assert.ok(!(other instanceof InvalidChatRequestError));
    assert.equal(other.model, "llama-3-70b");
  });
});

describe("qwen-3.5-35b routing", () => {
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

  it("sends streamed qwen-3.5-35b to akash as qwen-3.6-35b", async () => {
    const calls: Array<{ name: string; model: string; stream?: boolean }> = [];
    const selected = await router([
      provider("akash", [QWEN36, "llama-3-70b"], calls),
    ]).route(request("qwen-3.5-35b", true), parseRoutingPreference("provider:akash"));

    assert.equal(selected.provider, "akash");
    assert.equal(selected.response.model, QWEN36_UPSTREAM);
    assert.deepEqual(calls, [{ name: "akash", model: QWEN36, stream: true }]);
  });

  it("does not keep a provider that only lists the retired name", async () => {
    const calls: Array<{ name: string; model: string; stream?: boolean }> = [];
    await assert.rejects(
      () =>
        router([provider("akash", ["qwen-3.5-35b"], calls)]).route(
          request("qwen-3.5-35b", true),
          { strategy: "default" },
        ),
      (err: unknown) => {
        assert.ok(err instanceof ModelNotSupportedError);
        assert.equal(err.model, QWEN36);
        return true;
      },
    );
    assert.deepEqual(calls, []);
  });

  it("still sends other streamed models through unchanged", async () => {
    const calls: Array<{ name: string; model: string; stream?: boolean }> = [];
    const selected = await router([
      provider("akash", [QWEN36, "llama-3-70b"], calls),
    ]).route(request("llama-3-70b", true), { strategy: "default" });

    assert.equal(selected.provider, "akash");
    assert.deepEqual(calls, [{ name: "akash", model: "llama-3-70b", stream: true }]);
  });
});

describe("akash qwen-3.5-35b upstream", () => {
  afterEach(() => {
    mock.restoreAll();
  });

  it("asks Akash for Qwen 3.6 and returns that model id to the caller", async () => {
    let sent: { model?: string } | undefined;
    mock.method(globalThis, "fetch", async (_url: unknown, init?: RequestInit) => {
      sent = JSON.parse(String(init?.body)) as { model?: string };
      return new Response(
        JSON.stringify({
          id: "chatcmpl_test",
          object: "chat.completion",
          created: 0,
          model: QWEN36_UPSTREAM,
          choices: [
            {
              index: 0,
              finish_reason: "stop",
              message: { role: "assistant", content: "ok" },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });

    const parsed = parseChatBody({
      model: "qwen-3.5-35b",
      messages: [{ role: "user", content: "hi" }],
    });
    assert.ok(!(parsed instanceof InvalidChatRequestError));

    const akash = createAkashAdapter({
      apiKey: "test",
      baseUrl: "https://akash.test/v1",
    });
    const result = await akash.chatCompletion(parsed);

    assert.equal(sent?.model, QWEN36_UPSTREAM);
    assert.equal(result.response.model, QWEN36_UPSTREAM);
  });
});

describe("model_substitution expected id for qwen 3.5 aliases", () => {
  afterEach(() => {
    mock.restoreAll();
  });

  function substitutionLogs(lines: string[]): Array<Record<string, unknown>> {
    return lines
      .map((line) => JSON.parse(line) as { msg?: string })
      .filter((entry) => entry.msg === "model_substitution");
  }

  function routerWithAkash(): InferenceRouter {
    const health = new InMemoryHealthStore();
    health.set("akash", { healthy: true, latencyMs: 1, lastCheck: 1 });
    return new InferenceRouter(
      [
        createAkashAdapter({
          apiKey: "test",
          baseUrl: "https://akash.test/v1",
        }),
      ],
      health,
    );
  }

  function jsonResponse(model: string, headers?: Record<string, string>): Response {
    return new Response(
      JSON.stringify({
        id: "chatcmpl_test",
        object: "chat.completion",
        created: 0,
        model,
        choices: [
          {
            index: 0,
            finish_reason: "stop",
            message: { role: "assistant", content: "ok" },
          },
        ],
      }),
      { status: 200, headers: { "content-type": "application/json", ...headers } },
    );
  }

  it("expects the resolved 3.6 upstream id for every alias and stays quiet when that id comes back", async () => {
    const lines: string[] = [];
    mock.method(console, "info", (...args: unknown[]) => {
      lines.push(String(args[0]));
    });
    mock.method(globalThis, "fetch", async () => jsonResponse(QWEN36_UPSTREAM));

    const routed = routerWithAkash();
    for (const alias of Object.keys(MODEL_ALIASES)) {
      const selected = await routed.route(
        {
          model: alias,
          messages: [{ role: "user", content: "hi" }],
        },
        { strategy: "default" },
      );
      assert.equal(selected.response.model, QWEN36_UPSTREAM, alias);
    }

    assert.deepEqual(substitutionLogs(lines), []);
  });

  it("logs a real mismatch against the 3.6 upstream id, not the retired 3.5 id", async () => {
    const lines: string[] = [];
    mock.method(console, "info", (...args: unknown[]) => {
      lines.push(String(args[0]));
    });
    mock.method(globalThis, "fetch", async () => jsonResponse("some-other-model"));

    await routerWithAkash().route(
      {
        model: "Qwen3.5-35B-A3B",
        messages: [{ role: "user", content: "hi" }],
      },
      { strategy: "default" },
    );

    assert.deepEqual(substitutionLogs(lines), [
      {
        msg: "model_substitution",
        provider: "akash",
        requested: QWEN36,
        expected: QWEN36_UPSTREAM,
        returned: "some-other-model",
        source: "body",
      },
    ]);
  });

  it("does not log when a streamed alias response and its executed-model header are both 3.6", async () => {
    const lines: string[] = [];
    mock.method(console, "info", (...args: unknown[]) => {
      lines.push(String(args[0]));
    });
    const encoder = new TextEncoder();
    mock.method(globalThis, "fetch", async () => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({
                id: "chatcmpl_1",
                model: "Qwen/Qwen3.5-35B-A3B",
                choices: [{ index: 0, delta: { content: "hi" } }],
              })}\n\n`,
            ),
          );
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        },
      });
      return new Response(stream, {
        status: 200,
        headers: { "x-model-executed": QWEN36_UPSTREAM },
      });
    });

    const selected = await routerWithAkash().route(
      {
        model: "qwen-3.5-35b",
        messages: [{ role: "user", content: "hi" }],
        stream: true,
      },
      { strategy: "default" },
    );
    assert.ok(selected.stream);
    for await (const _chunk of selected.stream) {
      // Drain so a body-model check would have logged if the header had not won.
    }

    assert.deepEqual(substitutionLogs(lines), []);
  });
});
