import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { app as pdfExtractApp } from "@lmxcloud/pdf-extract/app";

const app = new Hono();

app.get("/health", (c) => c.json({ ok: true, tools: ["pdf-extract"] }));

app.route("/pdf-extract", pdfExtractApp);

const port = Number(process.env.PORT ?? 8080);
const hostname = process.env.HOST ?? "0.0.0.0";

serve({ fetch: app.fetch, port, hostname }, (info) => {
  console.log(`@lmxcloud/tools-host listening on http://${info.address}:${info.port}`);
});
