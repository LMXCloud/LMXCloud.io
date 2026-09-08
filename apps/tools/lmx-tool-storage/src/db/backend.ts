import path from "path";
import { fileURLToPath } from "url";

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export function getPackageDir(): string {
  return packageDir;
}

export function usePostgres(): boolean {
  return Boolean(process.env.DATABASE_URL?.trim());
}

export function sqliteFilePath(): string {
  return path.join(packageDir, "data", "vault.db");
}

export function backendMessage(): string {
  if (usePostgres()) return "Using Postgres";
  return "Using local SQLite at ./data/vault.db";
}
