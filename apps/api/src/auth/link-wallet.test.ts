import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { FileApiKeyStore } from "./store.js";

describe("FileApiKeyStore.linkWallet", () => {
  async function withStore(run: (store: FileApiKeyStore) => Promise<void>) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "lmx-link-wallet-"));
    const store = new FileApiKeyStore(path.join(dir, "keys.json"));
    try {
      await run(store);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }

  it("links a wallet to an email account", async () => {
    await withStore(async (store) => {
      const { record } = await store.create({ email: "dev@example.com" });
      const result = await store.linkWallet(
        record.id,
        "0x0000000000000000000000000000000000000001",
      );
      assert.equal(result.ok, true);
      if (!result.ok) return;
      assert.equal(result.record.wallet, "0x0000000000000000000000000000000000000001");
    });
  });

  it("rejects linking a wallet already used by another account", async () => {
    await withStore(async (store) => {
      await store.create({
        wallet: "0x0000000000000000000000000000000000000001",
      });
      const { record } = await store.create({ email: "dev@example.com" });
      const result = await store.linkWallet(
        record.id,
        "0x0000000000000000000000000000000000000001",
      );
      assert.equal(result.ok, false);
      if (result.ok) return;
      assert.equal(result.code, "wallet_taken");
    });
  });

  it("rejects wallet-only sessions", async () => {
    await withStore(async (store) => {
      const { record } = await store.create({
        wallet: "0x0000000000000000000000000000000000000002",
      });
      const result = await store.linkWallet(
        record.id,
        "0x0000000000000000000000000000000000000003",
      );
      assert.equal(result.ok, false);
      if (result.ok) return;
      assert.equal(result.code, "email_required");
    });
  });
});
