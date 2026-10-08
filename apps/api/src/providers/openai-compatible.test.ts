import assert from "node:assert/strict";
import { afterEach, describe, it, mock } from "node:test";
import type { ChatCompletionRequest } from "@lmxcloud/shared";
import { parseChatBody } from "../payments/quote-context.js";
import { InvalidChatRequestError } from "../payments/quote-errors.js";
import {
  PROVIDER_REJECTED_FIELDS,
  normalizeChatCompletionPayload,
  type ForwardedChatField,
} from "./chat-passthrough.js";
import {
  buildUpstreamChatBody,
  createOpenAiCompatibleAdapter,
} from "./openai-compatible.js";

const PROVIDERS = ["ionet", "akash", "aethir", "nosana", "together"] as const;

function baseRequest(
  extra: Partial<ChatCompletionRequest> = {},
): ChatCompletionRequest {
  return {
    model: "llama-3.3-70b",
    messages: [{ role: "user", content: "hi" }],
    stream: false,
    ...extra,
  };
}

describe("buildUpstreamChatBody", () => {
  it("matches the previous body when no extra fields are set", () => {
    const request = baseRequest({
      temperature: 0.2,
      max_tokens: 32,
      stream: true,
    });
    assert.deepEqual(buildUpstreamChatBody("ionet", "meta-llama/Llama-3.3-70B-Instruct", request), {
      model: "meta-llama/Llama-3.3-70B-Instruct",
      messages: request.messages,
      stream: true,
      stream_options: { include_usage: true },
      temperature: 0.2,
      max_tokens: 32,
      max_completion_tokens: 32,
    });

    const quiet = baseRequest();
    assert.deepEqual(buildUpstreamChatBody("akash", "upstream", quiet), {
      model: "upstream",
      messages: quiet.messages,
      stream: false,
    });
  });

  it("forwards the allowlist and leaves unknown fields off the body", () => {
    const parsed = parseChatBody({
      model: "qwen-3.6-35b",
      messages: [{ role: "user", content: "Say ok" }],
      max_tokens: 400,
      stream: true,
      tools: [
        {
          type: "function",
          function: { name: "ping", parameters: { type: "object", properties: {} } },
        },
      ],
      tool_choice: "auto",
      response_format: { type: "json_object" },
      reasoning_effort: "medium",
      chat_template_kwargs: { enable_thinking: false },
      top_p: 0.8,
      stop: "END",
      seed: 1,
      stream_options: { continuous_usage_stats: true },
      user: "drop-me",
    });
    assert.ok(
      !(parsed instanceof InvalidChatRequestError),
      parsed instanceof InvalidChatRequestError ? parsed.message : "ok",
    );

    for (const provider of PROVIDERS) {
      const body = buildUpstreamChatBody(provider, "qwen3.6-35b-a3b", parsed);
      assert.equal(body.tools && Array.isArray(body.tools), true, provider);
      assert.equal(body.tool_choice, "auto", provider);
      assert.deepEqual(body.response_format, { type: "json_object" }, provider);
      assert.equal(body.reasoning_effort, "medium", provider);
      assert.deepEqual(body.chat_template_kwargs, { enable_thinking: false }, provider);
      assert.equal(body.top_p, 0.8, provider);
      assert.equal(body.stop, "END", provider);
      assert.equal(body.seed, 1, provider);
      assert.equal("user" in body, false, provider);
      assert.deepEqual(body.stream_options, {
        include_usage: true,
        continuous_usage_stats: true,
      });
    }
  });

  it("sends reasoning_effort none when a hybrid Qwen caller did not set thinking", () => {
    for (const model of ["qwen-3.6-35b", "qwen-3.5-35b", "qwen-3.6-27b", "qwen3.6-35b-a3b", "Qwen/Qwen3.6-27B"]) {
      const body = buildUpstreamChatBody("ionet", "not-a-catalog-id", baseRequest({
        model,
        max_tokens: 64,
      }));
      assert.equal(body.reasoning_effort, "none", model);
      assert.equal("chat_template_kwargs" in body, false, model);
    }
  });

  it("keeps enable_thinking false and still sends reasoning_effort none", () => {
    const body = buildUpstreamChatBody("akash", "Qwen/Qwen3.5-35B-A3B", baseRequest({
      model: "qwen-3.5-35b",
      chat_template_kwargs: { enable_thinking: false, note: "keep" },
    }));
    assert.equal(body.reasoning_effort, "none");
    assert.deepEqual(body.chat_template_kwargs, { enable_thinking: false, note: "keep" });
  });

  it("forwards reasoning_effort or enable_thinking true without adding a default", () => {
    const enabled = buildUpstreamChatBody("akash", "Qwen/Qwen3.6-35B-A3B", baseRequest({
      model: "qwen-3.6-35b",
      chat_template_kwargs: { enable_thinking: true, extra: "keep" },
    }));
    assert.equal("reasoning_effort" in enabled, false);
    assert.deepEqual(enabled.chat_template_kwargs, { enable_thinking: true, extra: "keep" });

    const reasoned = buildUpstreamChatBody("aethir", "qwen3.6-35b-a3b", baseRequest({
      model: "qwen-3.6-35b",
      reasoning_effort: "low",
      chat_template_kwargs: { preserve: true },
    }));
    assert.equal(reasoned.reasoning_effort, "low");
    assert.deepEqual(reasoned.chat_template_kwargs, { preserve: true });

    const both = buildUpstreamChatBody("ionet", "Qwen/Qwen3.6-35B-A3B", baseRequest({
      model: "qwen-3.6-35b",
      reasoning_effort: "medium",
      chat_template_kwargs: { enable_thinking: false },
    }));
    assert.equal(both.reasoning_effort, "medium");
    assert.deepEqual(both.chat_template_kwargs, { enable_thinking: false });
  });

  it("leaves non-Qwen models without a thinking default", () => {
    const body = buildUpstreamChatBody("ionet", "meta-llama/Llama-3.3-70B-Instruct", baseRequest({
      model: "llama-3-70b",
      max_tokens: 64,
    }));
    assert.equal("chat_template_kwargs" in body, false);
    assert.equal("reasoning_effort" in body, false);
  });

  it("drops a field only for the provider that rejects it", () => {
    const rejected = PROVIDER_REJECTED_FIELDS as Record<string, ForwardedChatField[]>;
    rejected.aethir = ["chat_template_kwargs"];
    const request = baseRequest({
      chat_template_kwargs: { enable_thinking: false },
      response_format: { type: "json_object" },
    });
    try {
      const kept = buildUpstreamChatBody("ionet", "m", request);
      const dropped = buildUpstreamChatBody("aethir", "m", request);
      assert.deepEqual(kept.chat_template_kwargs, { enable_thinking: false });
      assert.deepEqual(kept.response_format, { type: "json_object" });
      assert.equal("chat_template_kwargs" in dropped, false);
      assert.deepEqual(dropped.response_format, { type: "json_object" });
    } finally {
      delete rejected.aethir;
    }
  });
});

describe("normalizeChatCompletionPayload", () => {
  it("passes a standard tool call through and does not rewrite content", () => {
    const content = "already correct";
    const payload = {
      id: "chatcmpl_1",
      choices: [
        {
          index: 0,
          finish_reason: "tool_calls",
          message: {
            role: "assistant",
            content,
            tool_calls: [
              {
                id: "call_1",
                type: "function",
                function: { name: "get_weather", arguments: "{\"city\":\"Paris\"}" },
              },
            ],
          },
        },
      ],
    };

    const out = normalizeChatCompletionPayload(payload);
    assert.equal(out, payload);
    assert.equal(out.choices[0]?.message.content, content);
    assert.equal(out.choices[0]?.finish_reason, "tool_calls");
  });

  it("sets finish_reason tool_calls without changing existing content", () => {
    const content = "";
    const payload = {
      choices: [
        {
          index: 0,
          finish_reason: "stop",
          message: {
            role: "assistant",
            content,
            tool_calls: [
              {
                id: "call_1",
                type: "function",
                function: { name: "ping", arguments: { ok: true } },
              },
            ],
          },
        },
      ],
    };

    const out = normalizeChatCompletionPayload(payload);
    assert.equal(out.choices[0]?.message.content, content);
    assert.equal(out.choices[0]?.finish_reason, "tool_calls");
    assert.equal(out.choices[0]?.message.tool_calls?.[0]?.function.arguments, "{\"ok\":true}");
    assert.equal(out.choices[0]?.message.tool_calls?.[0]?.id, "call_1");
  });

  it("passes streaming tool-call deltas through and leaves delta content alone", () => {
    const content = "Hello";
    const chunk = {
      choices: [
        {
          index: 0,
          finish_reason: null,
          delta: {
            content,
            tool_calls: [
              {
                index: 0,
                id: "call_1",
                type: "function",
                function: { name: "ping", arguments: "" },
              },
            ],
          },
        },
      ],
    };

    const out = normalizeChatCompletionPayload(chunk);
    assert.equal(out, chunk);
    assert.equal(out.choices[0]?.delta.content, content);
    assert.equal(out.choices[0]?.finish_reason, null);

    const finished = normalizeChatCompletionPayload({
      choices: [
        {
          index: 0,
          finish_reason: "stop",
          delta: {
            content: "",
            tool_calls: [
              {
                index: 0,
                function: { arguments: { city: "Paris" } },
              },
            ],
          },
        },
      ],
    });
    assert.equal(finished.choices[0]?.delta.content, "");
    assert.equal(finished.choices[0]?.finish_reason, "tool_calls");
    assert.equal(
      finished.choices[0]?.delta.tool_calls?.[0]?.function.arguments,
      "{\"city\":\"Paris\"}",
    );
    assert.equal(finished.choices[0]?.delta.tool_calls?.[0]?.index, 0);
    assert.equal("id" in (finished.choices[0]?.delta.tool_calls?.[0] ?? {}), false);
  });
});

describe("createOpenAiCompatibleAdapter chat passthrough", () => {
  afterEach(() => {
    mock.restoreAll();
  });

  function adapter(name = "ionet") {
    return createOpenAiCompatibleAdapter({
      name,
      tier: 1,
      costPer1kTokens: 0.0002,
      isDepin: true,
      apiKey: "test",
      baseUrl: "https://provider.test/v1",
      resolveModel: (model) => `upstream:${model}`,
      aliases: ["llama-3.3-70b", "qwen-3.6-35b"],
    });
  }

  it("logs response_format on the upstream request and returns tool_calls", async () => {
    const logs: string[] = [];
    mock.method(console, "info", (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    });

    let sent: unknown;
    mock.method(globalThis, "fetch", async (_url: string, init?: RequestInit) => {
      sent = JSON.parse(String(init?.body));
      return Response.json({
        id: "chatcmpl_tool",
        object: "chat.completion",
        created: 1,
        model: "upstream:llama-3.3-70b",
        choices: [
          {
            index: 0,
            finish_reason: "tool_calls",
            message: {
              role: "assistant",
              content: null,
              tool_calls: [
                {
                  id: "call_1",
                  type: "function",
                  function: { name: "get_weather", arguments: "{\"city\":\"Paris\"}" },
                },
              ],
            },
          },
        ],
      });
    });

    const parsed = parseChatBody({
      model: "llama-3.3-70b",
      messages: [{ role: "user", content: "Weather in Paris?" }],
      tools: [{ type: "function", function: { name: "get_weather" } }],
      tool_choice: "auto",
      response_format: { type: "json_object" },
    });
    assert.ok(
      !(parsed instanceof InvalidChatRequestError),
      parsed instanceof InvalidChatRequestError ? parsed.message : "ok",
    );

    const result = await adapter().chatCompletion(parsed);
    assert.equal((sent as { tool_choice?: string }).tool_choice, "auto");
    assert.deepEqual((sent as { response_format?: unknown }).response_format, {
      type: "json_object",
    });
    assert.equal(result.response.choices[0]?.finish_reason, "tool_calls");
    assert.equal(result.response.choices[0]?.message.tool_calls?.[0]?.function.name, "get_weather");
    assert.equal(result.response.choices[0]?.message.content, null);

    const line = logs.map((entry) => {
      try {
        return JSON.parse(entry) as { msg?: string; response_format?: { type?: string } };
      } catch {
        return undefined;
      }
    }).find((entry) => entry?.msg === "upstream_chat_fields");
    assert.equal(line?.response_format?.type, "json_object");
  });

  it("does not log a plain request", async () => {
    const logs: string[] = [];
    mock.method(console, "info", (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    });
    mock.method(globalThis, "fetch", async () =>
      Response.json({
        id: "chatcmpl_plain",
        object: "chat.completion",
        created: 1,
        model: "upstream:llama-3.3-70b",
        choices: [
          {
            index: 0,
            finish_reason: "stop",
            message: { role: "assistant", content: "hello" },
          },
        ],
      }),
    );

    const result = await adapter().chatCompletion(baseRequest({ temperature: 0 }));
    assert.equal(result.response.choices[0]?.message.content, "hello");
    assert.equal(result.response.choices[0]?.finish_reason, "stop");
    assert.equal(logs.some((line) => line.includes("upstream_chat_fields")), false);
  });

  it("forwards streaming tool-call deltas unchanged when they are already standard", async () => {
    const delta = {
      id: "chatcmpl_stream",
      choices: [
        {
          index: 0,
          finish_reason: null,
          delta: {
            content: null,
            tool_calls: [
              {
                index: 0,
                id: "call_1",
                type: "function",
                function: { name: "ping", arguments: "" },
              },
            ],
          },
        },
      ],
    };
    const done = {
      id: "chatcmpl_stream",
      choices: [{ index: 0, finish_reason: "tool_calls", delta: {} }],
    };
    const encoder = new TextEncoder();
    mock.method(globalThis, "fetch", async () => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(delta)}\n\n`));
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(done)}\n\n`));
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        },
      });
      return new Response(stream, { status: 200 });
    });

    const result = await adapter().chatCompletion(baseRequest({ stream: true }));
    assert.ok(result.stream);
    const frames: string[] = [];
    for await (const frame of result.stream) frames.push(frame);
    assert.match(frames[0] ?? "", /"tool_calls"/);
    assert.match(frames[0] ?? "", /"content":null/);
    assert.match(frames[1] ?? "", /"finish_reason":"tool_calls"/);
    assert.match(frames[2] ?? "", /\[DONE\]/);
  });

  it("logs one streamed model substitution and forwards the chunks unchanged", async () => {
    const lines: string[] = [];
    mock.method(console, "info", (...args: unknown[]) => {
      lines.push(String(args[0]));
    });

    const streamed = createOpenAiCompatibleAdapter({
      name: "nosana",
      tier: 1,
      costPer1kTokens: 0.0002,
      isDepin: true,
      apiKey: "test",
      baseUrl: "https://provider.test/v1",
      resolveModel: () => "Qwen/Qwen3.5-35B-A3B",
      aliases: ["qwen-3.5-35b"],
    });
    const chunks = [
      { id: "chatcmpl_1", choices: [{ index: 0, delta: { content: "" } }] },
      {
        id: "chatcmpl_1",
        model: "Qwen/Qwen3.6-35B-A3B",
        choices: [{ index: 0, delta: { content: "hi" } }],
      },
      {
        id: "chatcmpl_1",
        model: "Qwen/Qwen3.6-35B-A3B",
        choices: [{ index: 0, delta: { content: "!" } }],
      },
    ];
    const encoder = new TextEncoder();
    mock.method(globalThis, "fetch", async () => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          for (const chunk of chunks) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
          }
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        },
      });
      return new Response(stream, { status: 200 });
    });

    const result = await streamed.chatCompletion(
      baseRequest({ model: "qwen-3.5-35b", stream: true }),
    );
    assert.ok(result.stream);
    const frames: string[] = [];
    for await (const frame of result.stream) frames.push(frame);

    assert.deepEqual(frames, [
      ...chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`),
      "data: [DONE]\n\n",
    ]);
    const substitutions = lines
      .map((line) => JSON.parse(line) as { msg?: string; returned?: string; streaming?: boolean })
      .filter((entry) => entry.msg === "model_substitution");
    assert.equal(substitutions.length, 1);
    assert.equal(substitutions[0]?.returned, "Qwen/Qwen3.6-35B-A3B");
    assert.equal(substitutions[0]?.streaming, true);
  });
});
