import path from "path";
import { fileURLToPath } from "url";
import { runMigrations } from "../db/migrate.js";
import { FileApiKeyStore, type ApiKeyStore } from "./store.js";
import { PostgresApiKeyStore } from "./postgres-store.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function createApiKeyStore(): Promise<ApiKeyStore> {
  if (process.env.DATABASE_URL) {
    await runMigrations();
    return new PostgresApiKeyStore();
  }

  const dataPath =
    process.env.API_KEYS_FILE ??
    path.resolve(__dirname, "../../../../data/api-keys.json");

  return new FileApiKeyStore(dataPath);
}

export { createAuthHook } from "./middleware.js";
export type {
  ApiKeyRecord,
  ApiKeyStore,
  ApiKeyEnvironment,
  ProjectRecord,
  DeleteProjectResult,
} from "./store.js";
export { DEFAULT_PROJECT_NAME } from "./store.js";
