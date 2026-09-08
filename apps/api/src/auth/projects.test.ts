import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { normalizeProjectName, parseOptionalKeyName } from "./projects.js";
import { FileApiKeyStore } from "./store.js";

describe("normalizeProjectName", () => {
  it("trims and collapses whitespace", () => {
    assert.deepEqual(normalizeProjectName("  My   App  "), {
      ok: true,
      value: "My App",
    });
  });

  it("rejects empty and oversized names", () => {
    assert.equal(normalizeProjectName("").ok, false);
    assert.equal(normalizeProjectName("   ").ok, false);
    assert.equal(normalizeProjectName("x".repeat(81)).ok, false);
  });
});

describe("parseOptionalKeyName", () => {
  it("omits missing, null, and blank values", () => {
    assert.deepEqual(parseOptionalKeyName(undefined), { ok: true });
    assert.deepEqual(parseOptionalKeyName(null), { ok: true });
    assert.deepEqual(parseOptionalKeyName(""), { ok: true });
    assert.deepEqual(parseOptionalKeyName("   "), { ok: true });
  });

  it("normalizes a provided name", () => {
    assert.deepEqual(parseOptionalKeyName("  My Research Agent  "), {
      ok: true,
      value: "My Research Agent",
    });
  });

  it("rejects non-strings and oversized names", () => {
    assert.equal(parseOptionalKeyName(12).ok, false);
    assert.equal(parseOptionalKeyName("x".repeat(81)).ok, false);
  });
});

describe("FileApiKeyStore projects", () => {
  async function withStore(run: (store: FileApiKeyStore) => Promise<void>) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "lmx-projects-"));
    const store = new FileApiKeyStore(path.join(dir, "keys.json"));
    try {
      await run(store);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }

  it("assigns new keys to an auto-created Default project", async () => {
    await withStore(async (store) => {
      const { record } = await store.create({ email: "dev@example.com" });
      assert.ok(record.projectId);
      const projects = await store.listProjectsForRecord(record);
      assert.equal(projects.length, 1);
      assert.equal(projects[0]?.name, "Default");
      assert.equal(projects[0]?.isDefault, true);
      assert.equal(record.projectId, projects[0]?.id);
    });
  });

  it("backfills legacy keys without a project into Default", async () => {
    await withStore(async (store) => {
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), "lmx-legacy-projects-"));
      const filePath = path.join(dir, "keys.json");
      await fs.writeFile(
        filePath,
        JSON.stringify([
          {
            id: "legacy-1",
            keyHash: "hash",
            email: "dev@example.com",
            environment: "development",
            createdAt: "2026-01-01T00:00:00.000Z",
          },
        ]),
        "utf-8",
      );
      const legacyStore = new FileApiKeyStore(filePath);
      const owner = {
        id: "legacy-1",
        keyHash: "hash",
        email: "dev@example.com",
        environment: "development" as const,
        createdAt: "2026-01-01T00:00:00.000Z",
      };
      const projects = await legacyStore.listProjectsForRecord(owner);
      assert.equal(projects[0]?.name, "Default");
      const listed = await legacyStore.listForRecord(owner);
      assert.equal(listed[0]?.projectId, projects[0]?.id);
      await fs.rm(dir, { recursive: true, force: true });
    });
  });

  it("creates a named project and nests keys under it", async () => {
    await withStore(async (store) => {
      const { record } = await store.create({ email: "dev@example.com" });
      const project = await store.createProject(record, "Mobile app");
      assert.ok(project);
      const created = await store.create({
        email: "dev@example.com",
        projectId: project.id,
      });
      assert.equal(created.record.projectId, project.id);
      const nested = await store.listForRecord(record, { projectId: project.id });
      assert.equal(nested.length, 1);
      assert.equal(nested[0]?.id, created.record.id);
    });
  });

  it("rejects duplicate project names for the same account", async () => {
    await withStore(async (store) => {
      const { record } = await store.create({ email: "dev@example.com" });
      assert.equal(await store.createProject(record, "Default"), null);
      const created = await store.createProject(record, "Billing");
      assert.ok(created);
      assert.equal(await store.createProject(record, "billing"), null);
    });
  });

  it("moves keys to Default when a project is deleted", async () => {
    await withStore(async (store) => {
      const { record } = await store.create({ email: "dev@example.com" });
      const project = await store.createProject(record, "Staging");
      assert.ok(project);
      await store.updateKey(record.id, record, { projectId: project.id });
      const deleted = await store.deleteProject(project.id, record);
      assert.equal(deleted.ok, true);
      if (!deleted.ok) return;
      assert.equal(deleted.movedKeyCount, 1);
      const listed = await store.listForRecord(record);
      const projects = await store.listProjectsForRecord(record);
      assert.equal(projects.length, 1);
      assert.equal(listed[0]?.projectId, projects[0]?.id);
    });
  });

  it("refuses to delete the Default project", async () => {
    await withStore(async (store) => {
      const { record } = await store.create({ email: "dev@example.com" });
      const projects = await store.listProjectsForRecord(record);
      const deleted = await store.deleteProject(projects[0]!.id, record);
      assert.equal(deleted.ok, false);
      if (deleted.ok) return;
      assert.equal(deleted.code, "default_project");
    });
  });

  it("does not leak projects across accounts", async () => {
    await withStore(async (store) => {
      const { record: owner } = await store.create({ email: "dev@example.com" });
      const { record: other } = await store.create({ email: "other@example.com" });
      const project = await store.createProject(owner, "Secret");
      assert.ok(project);
      assert.equal(await store.findProjectForOwner(project.id, other), null);
      const moved = await store.updateKey(other.id, other, { projectId: project.id });
      assert.equal(moved, null);
    });
  });

  it("stores an optional agent name on create and rename", async () => {
    await withStore(async (store) => {
      const unnamed = await store.create({ email: "dev@example.com" });
      assert.equal(unnamed.record.name, undefined);

      const named = await store.create({
        email: "dev@example.com",
        name: "My Research Agent",
      });
      assert.equal(named.record.name, "My Research Agent");

      const renamed = await store.updateKey(named.record.id, named.record, {
        name: "Lab bot",
      });
      assert.equal(renamed?.name, "Lab bot");

      const listed = await store.listForRecord(named.record);
      const match = listed.find((entry) => entry.id === named.record.id);
      assert.equal(match?.name, "Lab bot");
    });
  });
});
