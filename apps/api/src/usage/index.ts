import path from "path";
import { fileURLToPath } from "url";
import { FileUsageStore, type UsageStore } from "./store.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createUsageStore(): UsageStore {
  const dataPath =
    process.env.USAGE_FILE ??
    path.resolve(__dirname, "../../../../data/usage.json");

  return new FileUsageStore(dataPath);
}

export type { KeyUsageStats, RecordUsageInput, UsageStore } from "./store.js";
