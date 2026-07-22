import type { ChatCompletionRequest } from "@lmxcloud/shared";
import { ProviderError, type ProviderAdapter, type ProviderHealthResult } from "./types.js";

export interface OpenAiCompatibleConfig {
  name: string;
  tier: number;
  costPer1kTokens: number;
  isDepin: boolean;
  apiKey: string;
  /** Single gateway URL (io.net / Akash / Together). Ignored when resolveBaseUrl is set. */
  baseUrl?: string;
  /**
   * Per-request base URL (e.g. Nosana per-deployment endpoints).
   * When set, takes precedence over baseUrl.
   */
  resolveBaseUrl?: (requestModel: string) => string;
  /**
   * URLs probed by healthCheck. Defaults to [baseUrl] when only baseUrl is set.
   * Healthy if any URL responds OK; latency is the minimum successful probe.
   */
  healthBaseUrls?: string[];
  resolveModel: (model: string) => string;
  aliases: string[];
  timeoutMs?: number;
}

function resolveRequestBaseUrl(
  config: OpenAiCompatibleConfig,
  requestModel: string,
): string {
  if (config.resolveBaseUrl) {
    return config.resolveBaseUrl(requestModel);
  }
  if (config.baseUrl) {
    return config.baseUrl;
  }
  throw new ProviderError(
    `${config.name} has no base URL configured`,
    config.name,
    500,
  );
}

async function readProbeErrorDetail(response: Response): Promise<string | undefined> {
  const text = await response.text().catch(() => "");
  if (!text) return undefined;
  try {
    const json = JSON.parse(text) as Record<string, unknown>;
    const msg =
      json.detail ??
      json.message ??
      (typeof json.error === "string"
        ? json.error
        : typeof json.error === "object" &&
            json.error &&
            "message" in json.error
          ? (json.error as { message?: string }).message
          : undefined);
    if (typeof msg === "string" && msg.trim()) return msg.trim().slice(0, 200);
  } catch {
    /* plain text body */
  }
  return text.trim().slice(0, 200) || undefined;
}

type ProbeResult = ProviderHealthResult & { baseUrl: string };

async function probeHealthUrl(
  baseUrl: string,
  apiKey: string,
  timeoutMs: number,
): Promise<ProbeResult> {
  const checkUrl = `${baseUrl}/models`;
  const start = performance.now();
  try {
    const response = await fetch(checkUrl, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(timeoutMs),
    });
    const latencyMs = Math.round(performance.now() - start);
    if (response.ok) {
      return { healthy: true, latencyMs, statusCode: response.status, checkUrl, baseUrl };
    }
    const errorDetail = await readProbeErrorDetail(response);
    return {
      healthy: false,
      latencyMs,
      statusCode: response.status,
      errorDetail,
      checkUrl,
      baseUrl,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Connection failed";
    return {
      healthy: false,
      latencyMs: null,
      errorDetail: message.slice(0, 200),
      checkUrl,
      baseUrl,
    };
  }
}

export function createOpenAiCompatibleAdapter(config: OpenAiCompatibleConfig): ProviderAdapter {
  const timeoutMs = config.timeoutMs ?? 30_000;
  const healthUrls =
    config.healthBaseUrls ?? (config.baseUrl ? [config.baseUrl] : []);

  return {
    name: config.name,
    tier: config.tier,
    costPer1kTokens: config.costPer1kTokens,
    isDepin: config.isDepin,
    aliases: config.aliases,

    supportsModel(model: string): boolean {
      return config.aliases.includes(model);
    },

    async healthCheck(): Promise<ProviderHealthResult> {
      if (healthUrls.length === 0) {
        return { healthy: false, latencyMs: null };
      }

      const results = await Promise.all(
        healthUrls.map((baseUrl) => probeHealthUrl(baseUrl, config.apiKey, timeoutMs)),
      );

      const healthy = results.filter((r) => r.healthy);
      if (healthy.length > 0) {
        const best = healthy.reduce((a, b) =>
          (a.latencyMs ?? Infinity) <= (b.latencyMs ?? Infinity) ? a : b,
        );
        return {
          healthy: true,
          latencyMs: best.latencyMs,
          statusCode: best.statusCode,
          checkUrl: best.checkUrl,
        };
      }

      const withLatency = results.filter((r) => r.latencyMs != null);
      const worst = results[0]!;
      const representative =
        withLatency.length > 0
          ? withLatency.reduce((a, b) =>
              (a.latencyMs ?? Infinity) <= (b.latencyMs ?? Infinity) ? a : b,
            )
          : worst;

      return {
        healthy: false,
        latencyMs: representative.latencyMs,
        statusCode: representative.statusCode,
        errorDetail: representative.errorDetail,
        checkUrl: representative.checkUrl,
      };
    },

    async chatCompletion(request: ChatCompletionRequest) {
      const start = performance.now();
      const upstreamModel = config.resolveModel(request.model);
      const baseUrl = resolveRequestBaseUrl(config, request.model);

      const body: Record<string, unknown> = {
        model: upstreamModel,
        messages: request.messages,
        stream: request.stream === true,
      };

      if (request.stream === true) {
        body.stream_options = { include_usage: true };
      }

      if (request.temperature !== undefined) {
        body.temperature = request.temperature;
      }

      const maxTokens = request.max_completion_tokens ?? request.max_tokens;
      if (maxTokens !== undefined) {
        body.max_tokens = maxTokens;
        body.max_completion_tokens = maxTokens;
      }

      let response: Response;
      try {
        response = await fetch(`${baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${config.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (err) {
        throw new ProviderError(
          `Failed to reach ${config.name} API`,
          config.name,
          undefined,
          err,
        );
      }

      const latencyMs = Math.round(performance.now() - start);

      if (!response.ok) {
        const errorText = await response.text();
        throw new ProviderError(
          `${config.name} returned ${response.status}: ${errorText}`,
          config.name,
          response.status,
        );
      }

      if (request.stream === true) {
        const parsed = parseProviderStream(response.body, config.name, upstreamModel);
        return {
          response: parsed.response,
          latencyMs,
          usage: parsed.usage,
          stream: parsed.stream,
        };
      }

      const data = (await response.json()) as Awaited<
        ReturnType<ProviderAdapter["chatCompletion"]>
      >["response"];

      return {
        response: data,
        latencyMs,
        usage: data.usage ?? null,
      };
    },
  };
}

function parseProviderStream(
  body: ReadableStream<Uint8Array> | null,
  providerName: string,
  upstreamModel: string,
): {
  response: Awaited<ReturnType<ProviderAdapter["chatCompletion"]>>["response"];
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number } | null;
  stream: AsyncIterable<string>;
} {
  if (!body) {
    throw new ProviderError("Provider returned empty stream body", providerName);
  }
  const streamBody = body;

  const decoder = new TextDecoder();
  let buffer = "";
  let done = false;

  async function* stream(): AsyncIterable<string> {
    for await (const chunk of iterateStreamChunks(streamBody, decoder)) {
      buffer += chunk;

      let boundary = buffer.indexOf("\n\n");
      while (boundary >= 0) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);

        const lines = frame
          .split("\n")
          .map((line) => line.trim())
          .filter((line) => line.startsWith("data:"));

        for (const line of lines) {
          const data = line.slice(5).trim();
          if (!data) continue;
          if (data === "[DONE]") {
            done = true;
            yield "data: [DONE]\n\n";
            continue;
          }

          const parsed = JSON.parse(data) as {
            [key: string]: unknown;
          };

          yield `data: ${JSON.stringify(parsed)}\n\n`;
        }

        boundary = buffer.indexOf("\n\n");
      }
    }

    if (!done) {
      yield "data: [DONE]\n\n";
    }
  }

  return {
    usage: null,
    stream: stream(),
    response: {
      id: "chatcmpl_streaming_placeholder",
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: upstreamModel,
      choices: [
        {
          index: 0,
          finish_reason: "stop",
          message: {
            role: "assistant",
            content: "",
          },
        },
      ],
    },
  };
}

async function* iterateStreamChunks(
  stream: ReadableStream<Uint8Array>,
  decoder: TextDecoder,
): AsyncIterable<string> {
  const reader = stream.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        yield decoder.decode(value, { stream: true });
      }
    }
    const tail = decoder.decode();
    if (tail) yield tail;
  } finally {
    reader.releaseLock();
  }
}
