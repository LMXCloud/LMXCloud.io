import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseChatBody } from "./quote-context.js";

describe("parseChatBody vision content", () => {
  it("accepts OpenAI-style image_url content parts on vision models", () => {
    const parsed = parseChatBody({
      model: "llama-3.2-90b-vision",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "What is in this image?" },
            {
              type: "image_url",
              image_url: { url: "https://example.com/cat.png" },
            },
          ],
        },
      ],
    });

    assert.equal(typeof parsed, "object");
    if (typeof parsed === "string") throw new Error(parsed);
    assert.equal(parsed.model, "llama-3.2-90b-vision");
    assert.ok(Array.isArray(parsed.messages[0]!.content));
  });

  it("rejects image content on text-only models with a clear error", () => {
    const parsed = parseChatBody({
      model: "llama-3-70b",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "Describe this" },
            {
              type: "image_url",
              image_url: { url: "data:image/png;base64,aaa" },
            },
          ],
        },
      ],
    });

    assert.equal(typeof parsed, "string");
    assert.match(String(parsed), /does not support image input/);
    assert.match(String(parsed), /llama-3\.2-90b-vision/);
  });

  it("still accepts plain string content", () => {
    const parsed = parseChatBody({
      model: "llama-3-70b",
      messages: [{ role: "user", content: "hello" }],
    });
    assert.equal(typeof parsed, "object");
    if (typeof parsed === "string") throw new Error(parsed);
    assert.equal(parsed.messages[0]!.content, "hello");
  });
});
