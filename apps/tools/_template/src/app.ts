import { Hono } from "hono";

/**
 * Tool routes are relative to the mount prefix (e.g. /your-tool).
 * Settlement/pricing gate goes on this app (per-tool), not on the root server —
 * each tool may be priced differently.
 */
export const app = new Hono();

// app.use("/your-route", settlementGate(...))  // per-tool gate lands here before deploy

app.get("/health", (c) => c.json({ ok: true }));
