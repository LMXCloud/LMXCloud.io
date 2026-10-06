import assert from "node:assert/strict";
import { afterEach, describe, it, mock } from "node:test";
import { logModelSubstitution } from "./router.js";

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
