import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import * as sqliteVec from "sqlite-vec";
import { sqliteFilePath } from "./backend.js";

let db: DatabaseSync | null = null;

export function getSqlite(): DatabaseSync {
  if (db) return db;

  const file = sqliteFilePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  db = new DatabaseSync(file, { allowExtension: true });
  try {
    sqliteVec.load(db);
  } catch (err) {
    db.close();
    db = null;
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Failed to load sqlite-vec. Semantic search needs a Node.js build that can load SQLite extensions (DatabaseSync.loadExtension). ${message}`,
    );
  }
  db.enableLoadExtension(false);
  return db;
}

export function closeSqlite(): void {
  if (db) {
    db.close();
    db = null;
  }
}
