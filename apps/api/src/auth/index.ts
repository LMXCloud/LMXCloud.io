import path from "path";
import { fileURLToPath } from "url";
import { FileApiKeyStore, type ApiKeyStore } from "./store.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createApiKeyStore(): ApiKeyStore {
  const dataPath =
    process.env.API_KEYS_FILE ??
    path.resolve(__dirname, "../../../../data/api-keys.json");

  return new FileApiKeyStore(dataPath);
}

export { createAuthHook } from "./middleware.js";
export type { ApiKeyRecord, ApiKeyStore } from "./store.js";
