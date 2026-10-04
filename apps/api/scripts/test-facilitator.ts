/**
 * Probe CDP x402 facilitator connectivity.
 * Usage: pnpm --filter @lmxcloud/api exec tsx scripts/test-facilitator.ts
 */
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { createFacilitatorConfig } from "@coinbase/x402";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../../.env"), override: true });

const config = createFacilitatorConfig(
  process.env.CDP_API_KEY_ID,
  process.env.CDP_API_KEY_SECRET,
);

async function main(): Promise<void> {
  const hasKeys = Boolean(process.env.CDP_API_KEY_ID && process.env.CDP_API_KEY_SECRET);
  console.log(JSON.stringify({ url: config.url, hasCdpKeys: hasKeys }, null, 2));

  if (!hasKeys) {
    throw new Error("CDP_API_KEY_ID and CDP_API_KEY_SECRET are required");
  }

  const headers = await config.createAuthHeaders();
  const supportedUrl = `${config.url}/supported`;
  const auth = headers.supported?.Authorization;
  if (!auth) {
    throw new Error("Failed to build CDP auth header for /supported");
  }

  const response = await fetch(supportedUrl, {
    method: "GET",
    headers: {
      Authorization: auth,
      "Correlation-Context": headers.supported["Correlation-Context"] ?? "",
    },
  });

  const body = await response.text();
  console.log(
    JSON.stringify(
      {
        status: response.status,
        body: body.slice(0, 2000),
      },
      null,
      2,
    ),
  );

  if (!response.ok) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
