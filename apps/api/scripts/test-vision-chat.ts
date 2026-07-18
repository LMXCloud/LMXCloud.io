/**
 * Live vision chat completion integration test.
 *
 * Fires a real POST /v1/chat/completions with image_url content against a
 * vision-flagged model and asserts the model describes the image (not just 200).
 * Also asserts the text-only rejection path returns 400 naming vision aliases.
 *
 * Usage:
 *   pnpm --filter @lmxcloud/api test:vision
 *   API_URL=http://localhost:3000 API_KEY=lmx_... MODEL=qwen-3.6-35b pnpm test:vision
 *
 * Note: llama-3.2-90b-vision currently accepts text on io.net but returns 404 for
 * multimodal image_url payloads — default to qwen-3.6-35b which is live on ionet+akash.
 */
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { listVisionModelAliases } from "@lmxcloud/shared";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

const API_URL = (process.env.API_URL ?? "http://localhost:3000").replace(/\/$/, "");
const VISION_MODEL =
  process.env.MODEL ?? process.env.VISION_MODEL ?? "qwen-3.6-35b";
const TEXT_ONLY_MODEL = process.env.TEXT_ONLY_MODEL ?? "llama-3-70b";
const REQUEST_TIMEOUT_MS = Number(process.env.VISION_TEST_TIMEOUT_MS ?? 180_000);

/** Distinctive public cat image (twemoji 🐱) — models should mention a cat / feline. */
const TEST_IMAGE_URL =
  process.env.VISION_TEST_IMAGE_URL ??
  "https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/1f431.png";

const CAT_CONTENT_RE =
  /\b(cat|cats|kitten|feline|tabby|whiskers|meow|🐱)\b/i;

type ChatMessage = {
  role?: string;
  content?: string | unknown;
  reasoning_content?: string;
};

type ChatResponse = {
  id?: string;
  model?: string;
  choices?: Array<{
    message?: ChatMessage;
    finish_reason?: string | null;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  error?: { message?: string; type?: string; code?: string };
};

function textFromContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "object" && part !== null && "text" in part) {
          return String((part as { text?: unknown }).text ?? "");
        }
        return "";
      })
      .join("\n");
  }
  return "";
}

/** Prefer visible content; fall back to reasoning_content (Qwen thinking models). */
function assistantText(message: ChatMessage | undefined): string {
  const content = textFromContent(message?.content).trim();
  if (content) return content;
  if (typeof message?.reasoning_content === "string") {
    return message.reasoning_content.trim();
  }
  return "";
}

async function ensureApiKey(): Promise<string> {
  const existing =
    process.env.API_KEY?.trim() || process.env.LMX_API_KEY?.trim() || "";
  if (existing) return existing;

  const res = await fetch(`${API_URL}/v1/auth/key`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: `vision-test-${Date.now()}@local.dev` }),
  });
  const body = (await res.json()) as {
    api_key?: string;
    error?: { message?: string };
  };
  if (!res.ok || !body.api_key) {
    throw new Error(
      `Failed to mint API key (${res.status}): ${body.error?.message ?? JSON.stringify(body)}`,
    );
  }
  console.log(`minted api key (prefix ${body.api_key.slice(0, 12)}...)`);
  return body.api_key;
}

async function topUpIfNeeded(apiKey: string): Promise<void> {
  const balanceRes = await fetch(`${API_URL}/v1/balance`, {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
  });
  if (!balanceRes.ok) {
    console.log(`balance check skipped (${balanceRes.status})`);
    return;
  }
  const balanceBody = (await balanceRes.json()) as { balance?: number };
  const balance = Number(balanceBody.balance ?? 0);
  console.log(`balance: $${balance}`);
  if (balance >= 0.01) return;

  const topUp = await fetch(`${API_URL}/v1/credits/topup`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ amount: 1 }),
  });
  const topUpBody = await topUp.text();
  console.log(`topup status=${topUp.status} body=${topUpBody.slice(0, 200)}`);
}

async function chatCompletion(
  apiKey: string,
  body: Record<string, unknown>,
  extraHeaders?: Record<string, string>,
): Promise<{ status: number; json: ChatResponse; headers: Headers }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${API_URL}/v1/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        ...extraHeaders,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const json = (await res.json()) as ChatResponse;
    return { status: res.status, json, headers: res.headers };
  } finally {
    clearTimeout(timer);
  }
}

function fail(message: string): never {
  console.error(`FAIL: ${message}`);
  process.exitCode = 1;
  throw new Error(message);
}

function pass(label: string, detail?: string): void {
  console.log(`PASS: ${label}${detail ? ` — ${detail}` : ""}`);
}

async function testRejection(apiKey: string): Promise<void> {
  console.log("\n=== Test 1: reject image content on text-only model ===");
  const { status, json } = await chatCompletion(apiKey, {
    model: TEXT_ONLY_MODEL,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: "What is in this image?" },
          {
            type: "image_url",
            image_url: { url: TEST_IMAGE_URL },
          },
        ],
      },
    ],
    max_tokens: 64,
  });

  console.log(`status=${status}`);
  console.log(`body=${JSON.stringify(json, null, 2)}`);

  if (status !== 400) {
    fail(`expected HTTP 400, got ${status}`);
  }

  const message = json.error?.message ?? "";
  if (!/does not support image input/i.test(message)) {
    fail(`error message missing image-support rejection: ${message}`);
  }

  const visionAliases = listVisionModelAliases();
  const missing = visionAliases.filter((alias) => !message.includes(alias));
  if (missing.length > 0) {
    fail(
      `error should name vision aliases (${visionAliases.join(", ")}); missing: ${missing.join(", ")}`,
    );
  }

  pass(
    "text-only rejection",
    `400 with vision aliases [${visionAliases.join(", ")}]`,
  );
}

async function testVisionCompletion(apiKey: string): Promise<void> {
  console.log("\n=== Test 2: vision model describes real image ===");
  console.log(`model=${VISION_MODEL}`);
  console.log(`image_url=${TEST_IMAGE_URL}`);

  // Sanity: image URL is reachable from this machine (provider will fetch it too).
  const imgRes = await fetch(TEST_IMAGE_URL, {
    headers: { "User-Agent": "LMXCloud-VisionIntegrationTest/1.0", Accept: "image/*" },
  });
  if (!imgRes.ok) {
    fail(`test image URL not reachable: HTTP ${imgRes.status} for ${TEST_IMAGE_URL}`);
  }
  const imgBytes = Buffer.from(await imgRes.arrayBuffer());
  console.log(
    `test image ok: ${imgBytes.byteLength} bytes, ${imgRes.headers.get("content-type")}`,
  );

  const { status, json, headers } = await chatCompletion(apiKey, {
    model: VISION_MODEL,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "Describe this image in one short sentence. Name the main animal if any.",
          },
          {
            type: "image_url",
            image_url: { url: TEST_IMAGE_URL },
          },
        ],
      },
    ],
    max_tokens: 128,
    temperature: 0,
  });

  const provider = headers.get("x-lmx-provider");
  const latency = headers.get("x-lmx-latency");
  const message = json.choices?.[0]?.message;
  const content = assistantText(message);

  console.log(`status=${status}`);
  console.log(`provider=${provider ?? "?"} latencyMs=${latency ?? "?"}`);
  console.log(`model=${json.model ?? "?"}`);
  console.log(`usage=${JSON.stringify(json.usage ?? null)}`);
  console.log(
    `content=${JSON.stringify(textFromContent(message?.content).slice(0, 300))}`,
  );
  console.log(
    `reasoning_content=${JSON.stringify((message?.reasoning_content ?? "").slice(0, 300))}`,
  );
  console.log(`assistant_text: ${content.slice(0, 500)}`);

  if (status !== 200) {
    fail(
      `expected HTTP 200 from vision model, got ${status}: ${json.error?.message ?? JSON.stringify(json)}`,
    );
  }

  if (!content.trim()) {
    fail("vision response had empty content and empty reasoning_content");
  }

  if (!CAT_CONTENT_RE.test(content)) {
    fail(
      `vision response did not describe the cat image (no cat/feline match): ${JSON.stringify(content.slice(0, 500))}`,
    );
  }

  pass(
    "vision completion",
    `provider=${provider ?? "?"} described cat → ${JSON.stringify(content.slice(0, 160))}`,
  );
}

async function main(): Promise<void> {
  console.log(`API_URL=${API_URL}`);
  console.log(`VISION_MODEL=${VISION_MODEL}`);
  console.log(`TEXT_ONLY_MODEL=${TEXT_ONLY_MODEL}`);
  console.log(`vision aliases in catalog: ${listVisionModelAliases().join(", ")}`);

  const health = await fetch(`${API_URL}/v1/status`).catch((err: Error) => {
    throw new Error(`API not reachable at ${API_URL}: ${err.message}`);
  });
  console.log(`status endpoint: HTTP ${health.status}`);

  const apiKey = await ensureApiKey();
  await topUpIfNeeded(apiKey);

  await testRejection(apiKey);
  await testVisionCompletion(apiKey);

  console.log("\nALL VISION INTEGRATION TESTS PASSED");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
