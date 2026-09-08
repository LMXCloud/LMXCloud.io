import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Load only this package's .env. Do not walk to the repo-root LMX database.
dotenv.config({ path: path.join(packageDir, ".env") });
