import { serve } from "@hono/node-server";
import "./env.js";
import { app } from "./app.js";
import { backendMessage } from "./db/backend.js";
import { runMigrations } from "./db/migrate.js";
import { backfillMissingEmbeddings } from "./embeddings/backfill.js";
import { warmEmbeddingProvider } from "./embeddings/index.js";

const port = Number(process.env.PORT ?? 8788);
const hostname = process.env.HOST ?? "0.0.0.0";

await runMigrations();
console.log(backendMessage());
await warmEmbeddingProvider();
await backfillMissingEmbeddings();

serve({ fetch: app.fetch, port, hostname }, (info) => {
  console.log(`@lmxcloud/lmx-tool-storage listening on http://${info.address}:${info.port}`);
});
